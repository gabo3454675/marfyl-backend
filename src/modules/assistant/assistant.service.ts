import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import { ConfigService } from "@nestjs/config";

import { GoogleGenerativeAI } from "@google/generative-ai";

import { isDevPreviewAuthEnabled } from "@/common/dev-preview";

import { AssistantChatDto } from "./dto/chat.dto";

const SYSTEM_PROMPT = `Eres MARFYL Assistant, copiloto del SaaS MARFYL para empresas en Venezuela.

Ayudas con POS, facturas, inventario, gastos y módulo Fiscal MARFYL (libros, retenciones, calendario SENIAT).

Responde en español, claro y conciso (máximo 3 párrafos). No inventes montos ni RIF.`;

/** Lite primero: menor consumo de cuota en tier gratuito. */

const FALLBACK_MODELS = [
  "gemini-2.0-flash-lite",

  "gemini-2.0-flash",

  "gemini-1.5-flash-8b",

  "gemini-1.5-flash-latest",
] as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class AssistantService {
  private readonly modelCandidates: string[];

  constructor(private readonly config: ConfigService) {
    const configured =
      this.config.get<string>("GEMINI_MODEL")?.trim() ||
      "gemini-2.0-flash-lite";

    this.modelCandidates = [configured, ...FALLBACK_MODELS].filter(
      (m, i, arr) => arr.indexOf(m) === i,
    );
  }

  async chat(dto: AssistantChatDto, orgName?: string) {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");

    if (!apiKey?.trim()) {
      throw new ServiceUnavailableException(
        "Asistente no configurado: defina GEMINI_API_KEY en el backend (.env).",
      );
    }

    const systemInstruction = orgName
      ? `${SYSTEM_PROMPT}\n\nOrganización activa: ${orgName}.`
      : SYSTEM_PROMPT;

    const history = (dto.history ?? []).slice(-8).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",

      parts: [{ text: m.content }],
    }));

    const userMessage = dto.context
      ? `[Contexto: ${dto.context}]\n${dto.message}`
      : dto.message;

    let lastError: string | null = null;

    let hadRateLimit = false;

    for (let i = 0; i < this.modelCandidates.length; i++) {
      const modelName = this.modelCandidates[i];

      try {
        if (hadRateLimit && i > 0) await sleep(1200);

        const genAI = new GoogleGenerativeAI(apiKey);

        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
        });

        const chat = model.startChat({ history });

        const result = await chat.sendMessage(userMessage);

        const text = result.response.text();

        if (!text?.trim()) {
          throw new BadRequestException("El modelo no devolvió texto.");
        }

        return { reply: text.trim(), model: modelName };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);

        lastError = msg;

        if (/429|quota|rate limit/i.test(msg)) hadRateLimit = true;

        if (this.isRetryableError(msg)) continue;

        throw new BadRequestException(this.toUserMessage(msg));
      }
    }

    if (isDevPreviewAuthEnabled() && hadRateLimit) {
      return {
        reply: this.demoReply(dto.message),

        model: "demo-local",
      };
    }

    throw new BadRequestException(
      this.toUserMessage(lastError ?? "Sin respuesta de Gemini."),
    );
  }

  private demoReply(message: string): string {
    const lower = message.toLowerCase();

    if (lower.includes("iva")) {
      return "Modo demo (cuota Gemini agotada): revise libro de ventas y compras en Fiscal MARFYL, valide retenciones y el calendario SENIAT. Cuando reactive la API, podré calcular estimaciones en vivo.";
    }

    if (lower.includes("factura")) {
      return "Modo demo: emita desde POS o Facturas; el libro de ventas se alimenta automáticamente. Configure RIF en Perfil fiscal para numeración de control.";
    }

    return "Modo demo activo: la cuota gratuita de Gemini está agotada. Espere unos minutos o cambie GEMINI_MODEL=gemini-2.0-flash-lite en backend/.env y reinicie. Mientras tanto, use Panel fiscal, libros y calendario en el menú.";
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
      return "Cuota de Gemini agotada. El servidor ya probó modelos lite; espere 1–2 minutos o reinicie el backend con GEMINI_MODEL=gemini-2.0-flash-lite.";
    }

    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }
}
