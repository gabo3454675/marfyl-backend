import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Content, GoogleGenerativeAI, Part } from "@google/generative-ai";
import { AssistantChatDto } from "./dto/chat.dto";
import {
  AssistantToolContext,
  AssistantToolsService,
} from "./assistant-tools.service";
import { AssistantLocalFallbackService } from "./assistant-local-fallback.service";
import {
  buildMarfylAssistantTools,
  MARFYL_SYSTEM_INSTRUCTION,
} from "./marfyl-assistant.tools";

const FALLBACK_MODELS = [
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-1.5-flash-8b",
  "gemini-1.5-flash-latest",
] as const;

const MAX_TOOL_CALLS = 12;
const MAX_HISTORY_MESSAGES = 24;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly modelCandidates: string[];

  constructor(
    private readonly config: ConfigService,
    private readonly toolsService: AssistantToolsService,
    private readonly localFallback: AssistantLocalFallbackService,
  ) {
    const configured =
      this.config.get<string>("GEMINI_MODEL")?.trim() ||
      "gemini-2.0-flash-lite";
    this.modelCandidates = [configured, ...FALLBACK_MODELS].filter(
      (m, i, arr) => arr.indexOf(m) === i,
    );
  }

  async chat(dto: AssistantChatDto, context: AssistantToolContext) {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    if (!apiKey?.trim()) {
      throw new ServiceUnavailableException(
        "Asistente no configurado: defina GEMINI_API_KEY en el backend (.env).",
      );
    }

    const systemInstruction = context.orgName
      ? `${MARFYL_SYSTEM_INSTRUCTION}\n\nOrganización activa: ${context.orgName} (ID ${context.organizationId}).`
      : `${MARFYL_SYSTEM_INSTRUCTION}\n\nOrganización activa ID: ${context.organizationId}.`;

    const userMessage = dto.context
      ? `[Contexto: ${dto.context}]\n${dto.message}`
      : dto.message;
    const historyContents = this.mapHistoryToContents(dto.history);

    let lastError: string | null = null;
    let hadRateLimit = false;

    for (let i = 0; i < this.modelCandidates.length; i++) {
      const modelName = this.modelCandidates[i];
      try {
        if (hadRateLimit && i > 0) await sleep(2000 + i * 500);

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
        });
        const tools = buildMarfylAssistantTools();

        const result = await this.executeWithFunctionCalling(
          model,
          userMessage,
          historyContents,
          tools,
          context,
        );
        return {
          ...result,
          model: result.model || modelName,
          ...(context.pendingSwitch
            ? { switchOrganization: context.pendingSwitch }
            : {}),
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = msg;
        if (/429|quota|rate limit/i.test(msg)) hadRateLimit = true;
        if (this.isRetryableError(msg)) continue;
        throw new BadRequestException(this.toUserMessage(msg));
      }
    }

    const local = await this.tryLocalFallback(dto.message, context);
    if (local) return local;

    throw new BadRequestException(
      this.toUserMessage(lastError ?? "Sin respuesta de Gemini."),
    );
  }

  private async tryLocalFallback(
    message: string,
    context: AssistantToolContext,
  ) {
    if (!this.localFallback.canHandle(message)) return null;
    const handled = await this.localFallback.handle(message, context);
    if (!handled) return null;
    this.logger.warn("Usando fallback local (Gemini no disponible)");
    return {
      reply: handled.reply,
      model: "marfyl-local",
      ...(context.pendingSwitch
        ? { switchOrganization: context.pendingSwitch }
        : {}),
    };
  }

  private mapHistoryToContents(
    history?: AssistantChatDto["history"],
  ): Content[] {
    if (!history?.length) return [];
    return history.slice(-MAX_HISTORY_MESSAGES).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));
  }

  private async executeWithFunctionCalling(
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
    userMessage: string,
    historyContents: Content[],
    tools: ReturnType<typeof buildMarfylAssistantTools>,
    context: AssistantToolContext,
  ): Promise<{ reply: string; model: string }> {
    const contents: Content[] = [
      ...historyContents,
      { role: "user", parts: [{ text: userMessage }] },
    ];

    let toolCallCount = 0;

    while (toolCallCount < MAX_TOOL_CALLS) {
      try {
        const result = await model.generateContent({
          contents,
          tools,
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        });

        const response = result.response;
        const candidate = response.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];
        const functionCall = parts.find((p) => p.functionCall)?.functionCall;

        if (functionCall?.name) {
          toolCallCount++;
          this.logger.log(
            `Function call: ${functionCall.name}(${JSON.stringify(functionCall.args ?? {})})`,
          );

          const toolResult = await this.toolsService.execute(
            functionCall.name,
            (functionCall.args ?? {}) as Record<string, unknown>,
            context,
          );

          contents.push({ role: "model", parts: parts as Part[] });
          contents.push({
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: functionCall.name,
                  response: toolResult.error
                    ? { error: toolResult.error }
                    : { result: toolResult.result },
                },
              },
            ],
          });
          continue;
        }

        const text = response.text();
        if (!text?.trim()) {
          throw new BadRequestException("El modelo no devolvió texto.");
        }

        return {
          reply: text.trim(),
          model: (model as { model?: string }).model ?? "gemini",
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/not supported|function.*not/i.test(msg)) {
          this.logger.warn(
            "Function calling no soportado, fallback a startChat",
          );
          return this.fallbackToStartChat(model, userMessage);
        }
        throw e;
      }
    }

    throw new BadRequestException("Máximo de llamadas a funciones excedido.");
  }

  private async fallbackToStartChat(
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>,
    userMessage: string,
  ): Promise<{ reply: string; model: string }> {
    const chat = model.startChat({});
    const result = await chat.sendMessage(userMessage);
    const text = result.response.text();
    if (!text?.trim())
      throw new BadRequestException("El modelo no devolvió texto.");
    return {
      reply: text.trim(),
      model: (model as { model?: string }).model ?? "gemini",
    };
  }

  private isRetryableError(message: string): boolean {
    return (
      /404/i.test(message) ||
      /not found/i.test(message) ||
      /not supported/i.test(message) ||
      /is not found for API version/i.test(message) ||
      /429/i.test(message) ||
      /quota/i.test(message) ||
      /rate limit/i.test(message) ||
      /503/i.test(message) ||
      /overloaded/i.test(message)
    );
  }

  private toUserMessage(raw: string): string {
    if (/404/i.test(raw) && /gemini/i.test(raw)) {
      return "Modelo de IA no disponible. Use GEMINI_MODEL=gemini-2.0-flash-lite en backend/.env y reinicie.";
    }
    if (/429|quota|rate limit/i.test(raw)) {
      return "Cuota de Gemini agotada. Espere 1–2 minutos o reinicie el backend.";
    }
    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }
}
