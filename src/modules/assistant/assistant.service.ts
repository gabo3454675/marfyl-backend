import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Groq } from "groq-sdk";
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from "groq-sdk/resources/chat/completions";
import { AssistantChatDto } from "./dto/chat.dto";
import {
  AssistantToolContext,
  AssistantToolsService,
} from "./assistant-tools.service";
import { AssistantLocalFallbackService } from "./assistant-local-fallback.service";
import {
  buildGroqAssistantTools,
  MARFYL_SYSTEM_INSTRUCTION,
} from "./marfyl-assistant.tools";

const DEFAULT_MODEL = "llama-3.1-8b-instant";
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

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly modelName: string;

  constructor(
    private readonly config: ConfigService,
    private readonly toolsService: AssistantToolsService,
    private readonly localFallback: AssistantLocalFallbackService,
  ) {
    this.modelName =
      this.config.get<string>("GROQ_MODEL")?.trim() || DEFAULT_MODEL;
  }

  async chat(dto: AssistantChatDto, context: AssistantToolContext) {
    let reply = "";
    let model = this.modelName;
    for await (const event of this.chatStream(dto, context)) {
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

  async *chatStream(
    dto: AssistantChatDto,
    context: AssistantToolContext,
  ): AsyncGenerator<AssistantStreamEvent> {
    const apiKey = this.config.get<string>("GROQ_API_KEY");
    if (!apiKey?.trim()) {
      throw new ServiceUnavailableException(
        "Asistente no configurado: defina GROQ_API_KEY en el backend (.env).",
      );
    }

    const systemInstruction = context.orgName
      ? `${MARFYL_SYSTEM_INSTRUCTION}\n\nOrganización activa: ${context.orgName} (ID ${context.organizationId}).`
      : `${MARFYL_SYSTEM_INSTRUCTION}\n\nOrganización activa ID: ${context.organizationId}.`;

    const userMessage = dto.context
      ? `[Contexto: ${dto.context}]\n${dto.message}`
      : dto.message;

    const groq = new Groq({ apiKey });
    const tools = buildGroqAssistantTools();
    const messages = this.buildMessages(
      systemInstruction,
      dto.history,
      userMessage,
    );

    try {
      const result = yield* this.executeWithToolCallingStream(
        groq,
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
    this.logger.warn("Usando fallback local (Groq no disponible)");
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

  private groqCompletionParams(
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    stream: boolean,
  ) {
    return {
      model: this.modelName,
      messages,
      tools,
      tool_choice: "auto" as const,
      temperature: 1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream,
    };
  }

  private async *executeWithToolCallingStream(
    groq: Groq,
    messages: ChatCompletionMessageParam[],
    tools: ChatCompletionTool[],
    context: AssistantToolContext,
  ): AsyncGenerator<AssistantStreamEvent, { reply: string; model: string }> {
    let toolCallCount = 0;
    let modelUsed = this.modelName;

    while (toolCallCount < MAX_TOOL_CALLS) {
      const stream = (await groq.chat.completions.create({
        ...this.groqCompletionParams(messages, tools, true),
        stream: true,
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
        (t, i) => ({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.arguments || "{}" },
          index: i,
        }),
      );

      messages.push({
        role: "assistant",
        content: reply || null,
        tool_calls: openAiToolCalls,
      });

      for (const toolCall of openAiToolCalls) {
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
      return `Modelo de IA no disponible. Use GROQ_MODEL=${DEFAULT_MODEL} en backend/.env y reinicie.`;
    }
    if (/429|quota|rate limit/i.test(raw)) {
      return "Límite de uso de Groq alcanzado. Espere 1–2 minutos e intente de nuevo.";
    }
    if (/GROQ_API_KEY|invalid api key|authentication/i.test(raw)) {
      return "Configure GROQ_API_KEY en backend/.env y reinicie el servidor en el puerto 3001.";
    }
    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }
}
