import { HfInference } from "@huggingface/inference";

/**
 * Embeddings gratuitos vía Hugging Face Inference Providers (sin OpenAI).
 * Modelo: paraphrase-multilingual-MiniLM-L12-v2 → 384 dimensiones.
 */
export const HF_EMBEDDING_MODEL =
  process.env.FISCAL_EMBEDDING_MODEL?.trim() ||
  "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2";

/** Router HF (api-inference.huggingface.co está descontinuado). */
export const HF_INFERENCE_URL = `https://router.huggingface.co/hf-inference/models/${HF_EMBEDDING_MODEL}`;

export const EMBEDDING_DIMENSIONS = 384;

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 4;

export function resolveHuggingFaceApiKey(): string | null {
  return (
    process.env.HUGGINGFACE_API_KEY?.trim() ||
    process.env.HF_TOKEN?.trim() ||
    null
  );
}

function isNestedMatrix(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    Array.isArray(value[0]) &&
    typeof value[0][0] === "number"
  );
}

function meanPoolTokenVectors(tokens: number[][]): number[] {
  const dim = tokens[0]?.length ?? 0;
  if (!dim) return [];
  const sum = new Array<number>(dim).fill(0);
  for (const token of tokens) {
    for (let i = 0; i < dim; i++) sum[i] += token[i] ?? 0;
  }
  return sum.map((v) => v / tokens.length);
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  if (!norm) return vector;
  return vector.map((v) => v / norm);
}

function flattenEmbeddingPayload(payload: unknown): number[] {
  if (isNestedMatrix(payload)) {
    return meanPoolTokenVectors(payload);
  }
  if (Array.isArray(payload) && typeof payload[0] === "number") {
    return payload as number[];
  }
  if (
    Array.isArray(payload) &&
    Array.isArray(payload[0]) &&
    typeof (payload[0] as number[])[0] === "number" &&
    !Array.isArray((payload[0] as unknown[])[0])
  ) {
    return meanPoolTokenVectors(payload as number[][]);
  }
  throw new Error("Formato de embedding no reconocido desde Hugging Face");
}

export interface GenerarEmbeddingOptions {
  apiKey?: string;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Genera un embedding de 384 dimensiones usando la Inference API gratuita de Hugging Face.
 */
export async function generarEmbeddingGratuito(
  text: string,
  options: GenerarEmbeddingOptions = {},
): Promise<number[]> {
  const input = text.replace(/\s+/g, " ").trim().slice(0, 8_000);
  if (!input) {
    throw new Error("Texto vacío para embedding");
  }

  const apiKey = options.apiKey ?? resolveHuggingFaceApiKey();
  if (!apiKey) {
    throw new Error(
      "HUGGINGFACE_API_KEY (o HF_TOKEN) no configurada para embeddings",
    );
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;

  let lastError: unknown;

  const hf = new HfInference(apiKey);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const parsed = await hf.featureExtraction(
        { model: HF_EMBEDDING_MODEL, inputs: input },
        { retry_on_error: false, fetch: (url, init) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          return fetch(url, { ...init, signal: controller.signal }).finally(() =>
            clearTimeout(timer),
          );
        }},
      );

      const vector = normalizeVector(flattenEmbeddingPayload(parsed));
      if (vector.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `Dimensión inesperada: ${vector.length} (esperado ${EMBEDDING_DIMENSIONS})`,
        );
      }
      return vector;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const retryable =
        /503|429|loading|timeout|rate|overloaded|abort/i.test(message);

      if (retryable && attempt < retries) {
        const waitMs = attempt * 2500;
        console.warn(
          `[HF embedding] Intento ${attempt}/${retries} falló (${message.slice(0, 120)}). Reintento en ${waitMs}ms…`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Error desconocido generando embedding"));
}

export function vectorToPgLiteral(vector: number[]): string {
  return `[${vector.map((n) => Number(n).toFixed(8)).join(",")}]`;
}
