import { ConfigService } from "@nestjs/config";
import OpenAI from "openai";

export type LlmProviderName = "nvidia" | "groq";

export type LlmPurpose = "assistant" | "fiscal" | "marfyl";

export type ResolvedLlm = {
  provider: LlmProviderName;
  model: string;
  client: OpenAI;
  /** Extra body fields (NVIDIA thinking, etc.) */
  extraBody: Record<string, unknown>;
};

const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const DEFAULT_GROQ_ASSISTANT = "llama-3.1-8b-instant";
const DEFAULT_GROQ_MARFYL = "llama-3.3-70b-versatile";

function readProvider(config: ConfigService): LlmProviderName {
  const explicit = config.get<string>("LLM_PROVIDER")?.trim().toLowerCase();
  if (explicit === "nvidia" || explicit === "groq") return explicit;

  // Si hay clave NVIDIA y no se forzó groq, preferir NVIDIA (Groq está 403).
  if (config.get<string>("NVIDIA_API_KEY")?.trim()) return "nvidia";
  return "groq";
}

function resolveModel(
  config: ConfigService,
  provider: LlmProviderName,
  purpose: LlmPurpose,
): string {
  if (provider === "nvidia") {
    const byPurpose =
      purpose === "assistant"
        ? config.get<string>("ASSISTANT_MODEL")?.trim()
        : purpose === "fiscal"
          ? config.get<string>("FISCAL_ADVISOR_MODEL")?.trim()
          : config.get<string>("MARFYL_MODEL")?.trim();

    // Modelos Groq no sirven en NVIDIA: ignorar si parecen llama-*/meta-*
    const candidate = byPurpose || config.get<string>("NVIDIA_MODEL")?.trim();
    if (candidate && !/^(llama|meta-llama|mixtral|gemma)/i.test(candidate)) {
      return candidate;
    }
    return (
      config.get<string>("NVIDIA_MODEL")?.trim() || DEFAULT_NVIDIA_MODEL
    );
  }

  if (purpose === "marfyl") {
    return config.get<string>("MARFYL_MODEL")?.trim() || DEFAULT_GROQ_MARFYL;
  }
  if (purpose === "fiscal") {
    return (
      config.get<string>("FISCAL_ADVISOR_MODEL")?.trim() ||
      config.get<string>("GROQ_MODEL")?.trim() ||
      DEFAULT_GROQ_ASSISTANT
    );
  }
  return config.get<string>("GROQ_MODEL")?.trim() || DEFAULT_GROQ_ASSISTANT;
}

/**
 * Resuelve cliente OpenAI-compatible (NVIDIA NIM o Groq) según .env.
 * No muta datos de negocio; solo configuración de chat.
 */
export function resolveLlm(
  config: ConfigService,
  purpose: LlmPurpose,
): ResolvedLlm {
  const provider = readProvider(config);
  const model = resolveModel(config, provider, purpose);

  if (provider === "nvidia") {
    const apiKey = config.get<string>("NVIDIA_API_KEY")?.trim();
    if (!apiKey) {
      throw new Error(
        "LLM_PROVIDER=nvidia pero falta NVIDIA_API_KEY en el backend (.env).",
      );
    }
    const baseURL =
      config.get<string>("NVIDIA_BASE_URL")?.trim() ||
      "https://integrate.api.nvidia.com/v1";

    // Thinking ayuda en fiscal; en asistente con tools suele ralentizar y confundir.
    const thinkingDefault = purpose === "assistant" ? "false" : "true";
    const enableThinking =
      (config.get<string>("NVIDIA_ENABLE_THINKING")?.trim() || thinkingDefault) ===
      "true";

    const client = new OpenAI({
      apiKey,
      baseURL,
      timeout: Number(config.get<string>("NVIDIA_TIMEOUT_MS") || 180_000),
      maxRetries: 1,
    });

    return {
      provider,
      model,
      client,
      extraBody: {
        chat_template_kwargs: { enable_thinking: enableThinking },
        ...(enableThinking
          ? {
              reasoning_budget: Number(
                config.get<string>("NVIDIA_REASONING_BUDGET") || 4096,
              ),
            }
          : {}),
      },
    };
  }

  const apiKey = config.get<string>("GROQ_API_KEY")?.trim();
  if (!apiKey) {
    throw new Error(
      "Asistente no configurado: defina GROQ_API_KEY o NVIDIA_API_KEY / LLM_PROVIDER=nvidia.",
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: "https://api.groq.com/openai/v1",
    timeout: 60_000,
    maxRetries: 2,
  });

  return { provider, model, client, extraBody: {} };
}

export function isLlmConfigured(config: ConfigService): boolean {
  try {
    readProvider(config);
    const provider = readProvider(config);
    if (provider === "nvidia") {
      return Boolean(config.get<string>("NVIDIA_API_KEY")?.trim());
    }
    return Boolean(config.get<string>("GROQ_API_KEY")?.trim());
  } catch {
    return false;
  }
}
