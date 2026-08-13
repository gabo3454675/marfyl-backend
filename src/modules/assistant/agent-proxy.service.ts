import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AssistantChatDto } from "./dto/chat.dto";
import type { AssistantToolContext } from "./assistant-tools.service";
import type { AssistantStreamEvent } from "./assistant.service";

const DEFAULT_PYTHON_AGENT_URL = "http://localhost:8000";
/** Absolute ceiling for a full agent turn (tools + Nemotron). */
const DEFAULT_PROXY_TIMEOUT_MS = 180_000;
/** Abort if no SSE bytes arrive for this long (stuck LLM/tool). */
const DEFAULT_PROXY_IDLE_TIMEOUT_MS = 90_000;

export type PythonAgentChatResponse = {
  reply: string;
  tools_used?: string[];
  model?: string;
  thread_id?: string;
};

/**
 * Proxy NestJS → microservicio agent-marfyl (FastAPI).
 *
 * Activación (backend/.env):
 *   USE_PYTHON_AGENT=true
 *   PYTHON_AGENT_URL=http://localhost:8000   # sin /api
 *   AGENT_SECRET=<mismo valor que agent-marfyl>
 *   PYTHON_AGENT_FALLBACK=false              # true = si Python falla, AssistantService usa Groq
 *   PYTHON_AGENT_TIMEOUT_MS=180000           # techo absoluto por turn
 *   PYTHON_AGENT_IDLE_TIMEOUT_MS=90000       # idle entre chunks SSE
 *
 * Endpoints: POST /chat , POST /chat/stream (SSE: delta | tool_round | done | error)
 */
@Injectable()
export class AgentProxyService {
  private readonly logger = new Logger(AgentProxyService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    const v = this.config.get<string>("USE_PYTHON_AGENT")?.trim().toLowerCase();
    return v === "true" || v === "1";
  }

  isFallbackEnabled(): boolean {
    const v = this.config
      .get<string>("PYTHON_AGENT_FALLBACK")
      ?.trim()
      .toLowerCase();
    return v === "true" || v === "1";
  }

  async chat(
    dto: AssistantChatDto,
    context: AssistantToolContext,
  ): Promise<{ reply: string; model: string }> {
    this.assertIdentity(context);
    const url = `${this.baseUrl()}/chat`;
    const timeoutMs = this.timeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(context),
        body: JSON.stringify(this.buildBody(dto, context)),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`,
        );
      }

      const data = (await res.json()) as PythonAgentChatResponse;
      return {
        reply: typeof data.reply === "string" ? data.reply : "",
        model:
          typeof data.model === "string" && data.model.trim()
            ? data.model
            : "python-agent",
      };
    } catch (e: unknown) {
      throw this.toProxyError(e, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  async *chatStream(
    dto: AssistantChatDto,
    context: AssistantToolContext,
  ): AsyncGenerator<AssistantStreamEvent> {
    this.assertIdentity(context);
    const url = `${this.baseUrl()}/chat/stream`;
    const timeoutMs = this.timeoutMs();
    const idleMs = this.idleTimeoutMs();
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const absoluteTimer = setTimeout(() => controller.abort(), timeoutMs);
    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleMs);
    };
    bumpIdle();

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(context),
        body: JSON.stringify(this.buildBody(dto, context)),
        signal: controller.signal,
      });
      bumpIdle();

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        yield {
          type: "error",
          message: `Agent Python HTTP ${res.status}: ${text.slice(0, 200) || res.statusText}`,
        };
        return;
      }

      if (!res.body) {
        yield {
          type: "error",
          message: "Agent Python: respuesta sin body (SSE).",
        };
        return;
      }

      yield* this.parseSseStream(res.body, bumpIdle);
    } catch (e: unknown) {
      const err = this.toProxyError(e, timeoutMs);
      yield { type: "error", message: err.message };
    } finally {
      clearTimeout(absoluteTimer);
      if (idleTimer) clearTimeout(idleTimer);
    }
  }

  /** Exposed for unit tests — parse one SSE frame (`data: {...}`). */
  parseSseDataLine(rawFrame: string): AssistantStreamEvent | null {
    return this.parseSseEvent(rawFrame);
  }

  private baseUrl(): string {
    const raw =
      this.config.get<string>("PYTHON_AGENT_URL")?.trim() ||
      DEFAULT_PYTHON_AGENT_URL;
    return raw.replace(/\/+$/, "");
  }

  private timeoutMs(): number {
    const raw = this.config.get<string>("PYTHON_AGENT_TIMEOUT_MS")?.trim();
    const n = raw ? Number.parseInt(raw, 10) : DEFAULT_PROXY_TIMEOUT_MS;
    return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_PROXY_TIMEOUT_MS;
  }

  private idleTimeoutMs(): number {
    const raw = this.config.get<string>("PYTHON_AGENT_IDLE_TIMEOUT_MS")?.trim();
    const n = raw ? Number.parseInt(raw, 10) : DEFAULT_PROXY_IDLE_TIMEOUT_MS;
    return Number.isFinite(n) && n >= 5_000 ? n : DEFAULT_PROXY_IDLE_TIMEOUT_MS;
  }

  private buildHeaders(context: AssistantToolContext): Record<string, string> {
    const secret = this.config.get<string>("AGENT_SECRET")?.trim() ?? "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Internal-Secret": secret,
      "X-Organization-Id": String(context.organizationId),
      "X-User-Id": String(context.userId),
    };
    if (context.authorization?.trim()) {
      headers.Authorization = context.authorization.trim();
    }
    return headers;
  }

  private buildBody(dto: AssistantChatDto, context: AssistantToolContext) {
    const message = dto.context
      ? `[Contexto: ${dto.context}]\n${dto.message}`
      : dto.message;

    return {
      message,
      history:
        dto.history?.map((h) => ({
          role: h.role,
          content: h.content,
        })) ?? null,
      organization_id: context.organizationId,
      user_id: context.userId,
      org_name: context.orgName ?? null,
      user_role: context.userRole ?? null,
    };
  }

  private assertIdentity(context: AssistantToolContext): void {
    if (
      !Number.isInteger(context.organizationId) ||
      context.organizationId <= 0
    ) {
      throw new ServiceUnavailableException(
        "Agent proxy: organizationId debe ser un entero positivo (> 0).",
      );
    }
    if (!Number.isInteger(context.userId) || context.userId <= 0) {
      throw new ServiceUnavailableException(
        "Agent proxy: userId debe ser un entero positivo (> 0).",
      );
    }
  }

  private async *parseSseStream(
    body: ReadableStream<Uint8Array>,
    onChunk?: () => void,
  ): AsyncGenerator<AssistantStreamEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk?.();
        buffer += decoder.decode(value, { stream: true });

        let sep = buffer.indexOf("\n\n");
        while (sep !== -1) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = this.parseSseEvent(rawEvent);
          if (event) yield event;
          sep = buffer.indexOf("\n\n");
        }
      }

      if (buffer.trim()) {
        const event = this.parseSseEvent(buffer);
        if (event) yield event;
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseSseEvent(raw: string): AssistantStreamEvent | null {
    const dataLines: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) return null;

    const payload = dataLines.join("\n");
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      return this.normalizeEvent(parsed);
    } catch {
      this.logger.warn(`SSE no JSON: ${payload.slice(0, 120)}`);
      return null;
    }
  }

  private normalizeEvent(
    parsed: Record<string, unknown>,
  ): AssistantStreamEvent | null {
    const type = parsed.type;
    if (type === "delta" && typeof parsed.text === "string") {
      return { type: "delta", text: parsed.text };
    }
    if (type === "tool_round") {
      return { type: "tool_round" };
    }
    if (type === "done") {
      return {
        type: "done",
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        model:
          typeof parsed.model === "string" && parsed.model.trim()
            ? parsed.model
            : "python-agent",
      };
    }
    if (type === "error") {
      return {
        type: "error",
        message:
          typeof parsed.message === "string"
            ? parsed.message
            : "Error del agente Python",
      };
    }
    return null;
  }

  private toProxyError(e: unknown, timeoutMs = DEFAULT_PROXY_TIMEOUT_MS): Error {
    if (e instanceof Error && e.name === "AbortError") {
      const secs = Math.round(timeoutMs / 1000);
      return new Error(
        `Agent Python: timeout (~${secs}s). El turno con tools/Nemotron superó el límite; reintente o suba PYTHON_AGENT_TIMEOUT_MS.`,
      );
    }
    if (e instanceof ServiceUnavailableException) {
      return e;
    }
    if (e instanceof Error) {
      return new Error(`Agent Python no disponible: ${e.message}`);
    }
    return new Error(`Agent Python no disponible: ${String(e)}`);
  }
}
