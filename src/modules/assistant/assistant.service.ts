import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { AssistantChatDto } from "./dto/chat.dto";
import {
  AssistantToolContext,
  AssistantToolsService,
} from "./assistant-tools.service";
import { AssistantLocalFallbackService } from "./assistant-local-fallback.service";
import { AgentProxyService } from "./agent-proxy.service";
import {
  buildGroqAssistantTools,
  MARFYL_SYSTEM_INSTRUCTION,
} from "./marfyl-assistant.tools";
import { resolveLlm } from "@/common/llm/llm-provider";

const MAX_TOOL_CALLS = 12;
const MAX_HISTORY_MESSAGES = 24;

export type AssistantStreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool_round" }
  | {
      type: "done";
      reply: string;
      model: string;
      switchOrganization?: AssistantToolContext["pendingSwitch"];
    }
  | { type: "error"; message: string };

type ToolCallAccum = {
  id: string;
  name: string;
  arguments: string;
};

/**
 * Asistente Marfyl.
 *
 * Por defecto: LLM_PROVIDER (nvidia|groq) + tools locales.
 * Con USE_PYTHON_AGENT=true: reenvía a agent-marfyl vía AgentProxyService.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly toolsService: AssistantToolsService,
    private readonly localFallback: AssistantLocalFallbackService,
    private readonly agentProxy: AgentProxyService,
  ) {}

  async chat(dto: AssistantChatDto, context: AssistantToolContext) {
    if (this.agentProxy.isEnabled()) {
      try {
        const result = await this.agentProxy.chat(dto, context);
        return {
          reply: result.reply,
          model: result.model,
          ...(context.pendingSwitch
            ? { switchOrganization: context.pendingSwitch }
            : {}),
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!this.agentProxy.isFallbackEnabled()) {
          throw new ServiceUnavailableException(msg);
        }
        this.logger.warn(`Python agent falló; fallback LLM (chat): ${msg}`);
      }
    }

    return this.aggregateChat(dto, context);
  }

  async *chatStream(
    dto: AssistantChatDto,
    context: AssistantToolContext,
  ): AsyncGenerator<AssistantStreamEvent> {
    if (this.agentProxy.isEnabled()) {
      let proxyError: string | null = null;
      for await (const event of this.agentProxy.chatStream(dto, context)) {
        if (event.type === "error") {
          proxyError = event.message;
          break;
        }
        yield event;
      }
      if (!proxyError) return;

      if (!this.agentProxy.isFallbackEnabled()) {
        yield { type: "error", message: proxyError };
        return;
      }
      this.logger.warn(
        `Python agent falló; fallback LLM (stream): ${proxyError}`,
      );
    }

    yield* this.chatStreamLlm(dto, context);
  }

  private async aggregateChat(
    dto: AssistantChatDto,
    context: AssistantToolContext,
  ) {
    let reply = "";
    let model = "unknown";
    for await (const event of this.chatStreamLlm(dto, context)) {
      if (event.type === "delta") reply += event.text;
      if (event.type === "done") {
        reply = event.reply;
        model = event.model;
      }
      if (event.type === "error") {
        throw new BadRequestException(event.message);
      }
    }
    return {
      reply,
      model,
      ...(context.pendingSwitch
        ? { switchOrganization: context.pendingSwitch }
        : {}),
    };
  }

  private async *chatStreamLlm(
    dto: AssistantChatDto,
    context: AssistantToolContext,
  ): AsyncGenerator<AssistantStreamEvent> {
    let llm;
    try {
      llm = resolveLlm(this.config, "assistant");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(msg);
    }

    this.logger.log(`Asistente LLM: provider=${llm.provider} model=${llm.model}`);

    const shortModel =
      llm.provider === "nvidia" ? "Nemotron" : llm.model.split("/").pop() || llm.model;
    const identityLine = `\n\nSi preguntan qué modelo/IA eres, responde solo: "${shortModel}". Nada más. No uses herramientas.`;
    const systemInstruction = context.orgName
      ? `${MARFYL_SYSTEM_INSTRUCTION}${identityLine}\n\nOrganización activa: ${context.orgName} (ID ${context.organizationId}).`
      : `${MARFYL_SYSTEM_INSTRUCTION}${identityLine}\n\nOrganización activa ID: ${context.organizationId}.`;

    const userMessage = dto.context
      ? `[Contexto: ${dto.context}]\n${dto.message}`
      : dto.message;

    const tools = buildGroqAssistantTools() as ChatCompletionTool[];
    const messages = this.buildMessages(
      systemInstruction,
      dto.history,
      userMessage,
    );

    try {
      const result = yield* this.executeWithToolCallingStream(
        llm.client,
        llm.model,
        llm.extraBody,
        messages,
        tools,
        context,
      );
      yield {
        type: "done",
        reply: result.reply,
        model: result.model,
        ...(context.pendingSwitch
          ? { switchOrganization: context.pendingSwitch }
          : {}),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const local = await this.tryLocalFallback(dto.message, context);
      if (local) {
        yield { type: "delta", text: local.reply };
        yield {
          type: "done",
          reply: local.reply,
          model: "marfyl-local",
          ...(context.pendingSwitch
            ? { switchOrganization: context.pendingSwitch }
            : {}),
        };
        return;
      }
      yield { type: "error", message: this.toUserMessage(msg) };
    }
  }

  private async tryLocalFallback(
    message: string,
    context: AssistantToolContext,
  ) {
    if (!this.localFallback.canHandle(message)) return null;
    const handled = await this.localFallback.handle(message, context);
    if (!handled) return null;
    this.logger.warn("Usando fallback local (LLM no disponible)");
    return {
      reply: handled.reply,
      model: "marfyl-local",
      ...(context.pendingSwitch
        ? { switchOrganization: context.pendingSwitch }
        : {}),
    };
  }

  private buildMessages(
    systemInstruction: string,
    history: AssistantChatDto["history"],
    userMessage: string,
  ): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemInstruction },
    ];

    if (history?.length) {
      for (const entry of history.slice(-MAX_HISTORY_MESSAGES)) {
        messages.push({
          role: entry.role === "assistant" ? "assistant" : "user",
          content: entry.content,
        });
      }
    }

    messages.push({ role: "user", content: userMessage });
    return messages;
  }

  private mergeToolCallDelta(
    acc: Map<number, ToolCallAccum>,
    deltas: ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined,
  ) {
    if (!deltas?.length) return;
    for (const delta of deltas) {
      const index = delta.index ?? 0;
      let entry = acc.get(index);
      if (!entry) {
        entry = { id: "", name: "", arguments: "" };
        acc.set(index, entry);
      }
      if (delta.id) entry.id = delta.id;
      if (delta.function?.name) entry.name += delta.function.name;
      if (delta.function?.arguments) entry.arguments += delta.function.arguments;
    }
  }

  private async *executeWithToolCallingStream(
    client: ReturnType<typeof resolveLlm>["client"],
    modelName: string,
    extraBody: Record<string, unknown>,
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    context: AssistantToolContext,
  ): AsyncGenerator<AssistantStreamEvent, { reply: string; model: string }> {
    let toolCallCount = 0;
    let modelUsed = modelName;
    const maxTokens = Number(
      this.config.get<string>("ASSISTANT_MAX_TOKENS") || 2048,
    );

    while (toolCallCount < MAX_TOOL_CALLS) {
      const stream = (await client.chat.completions.create({
        model: modelName,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 1,
        max_tokens: maxTokens,
        top_p: 1,
        stream: true,
        ...extraBody,
      })) as AsyncIterable<ChatCompletionChunk>;

      let reply = "";
      const toolAcc = new Map<number, ToolCallAccum>();

      for await (const chunk of stream) {
        if (chunk.model) modelUsed = chunk.model;
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          reply += delta.content;
          yield { type: "delta", text: delta.content };
        }
        this.mergeToolCallDelta(toolAcc, delta?.tool_calls);
      }

      const toolCalls = [...toolAcc.values()].filter((t) => t.id && t.name);
      if (toolCalls.length === 0) {
        const text = reply.trim();
        if (!text) {
          throw new BadRequestException("El modelo no devolvió texto.");
        }
        return { reply: text, model: modelUsed };
      }

      yield { type: "tool_round" };

      const openAiToolCalls: ChatCompletionMessageToolCall[] = toolCalls.map(
        (t) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments || "{}" },
        }),
      );

      messages.push({
        role: "assistant",
        content: reply || null,
        tool_calls: openAiToolCalls,
      });

      for (const toolCall of openAiToolCalls) {
        if (toolCall.type !== "function") continue;
        toolCallCount++;
        const toolName = toolCall.function.name;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || "{}") as Record<
            string,
            unknown
          >;
        } catch {
          args = {};
        }

        this.logger.log(`Function call: ${toolName}(${JSON.stringify(args)})`);

        const toolResult = await this.toolsService.execute(
          toolName,
          args,
          context,
        );

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(
            toolResult.error
              ? { error: toolResult.error }
              : { result: toolResult.result },
          ),
        });
      }
    }

    throw new BadRequestException("Máximo de llamadas a funciones excedido.");
  }

  private toUserMessage(raw: string): string {
    if (/404/i.test(raw) && /model/i.test(raw)) {
      return "Modelo de IA no disponible. Revise NVIDIA_MODEL / GROQ_MODEL en backend/.env y reinicie.";
    }
    if (/429|quota|rate limit|ResourceExhausted/i.test(raw)) {
      return "Límite de uso del proveedor de IA alcanzado. Espere 1–2 minutos e intente de nuevo.";
    }
    if (/NVIDIA_API_KEY|GROQ_API_KEY|invalid api key|authentication|401|403/i.test(raw)) {
      return "Configure NVIDIA_API_KEY (o GROQ_API_KEY) en backend/.env y reinicie el servidor.";
    }
    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }
}
