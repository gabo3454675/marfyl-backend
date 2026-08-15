/** Timeout mínimo (ms) hacia Hybrid. */
export const HYBRID_TIMEOUT_MIN_MS = 60_000;
/** Timeout máximo (ms) hacia Hybrid. */
export const HYBRID_TIMEOUT_MAX_MS = 180_000;
/**
 * Timeout por defecto para listados/catálogos si env ausente o inválido.
 * Alineado con README v0.4.0 (~60 s en listados).
 */
export const HYBRID_TIMEOUT_DEFAULT_MS = 60_000;

export type HybridAuthMode = "bearer" | "x-api-key";

export function getHybridApiBaseUrl(): string {
  return process.env.HYBRID_API_BASE_URL?.trim() ?? "";
}

/** Hostname de la base Hybrid (sin path/credenciales). Null si URL inválida/vacía. */
export function getHybridApiBaseUrlHost(): string | null {
  const base = getHybridApiBaseUrl();
  if (!base) return null;
  try {
    return new URL(base).hostname || null;
  } catch {
    return null;
  }
}

export function getHybridApiToken(): string {
  return process.env.HYBRID_API_TOKEN?.trim() ?? "";
}

/** True solo si BASE_URL y TOKEN no están vacíos. */
export function isConfigured(): boolean {
  return Boolean(getHybridApiBaseUrl() && getHybridApiToken());
}

/**
 * Timeout para listados/catálogos, clamped a [60000, 180000].
 * Lee HYBRID_API_TIMEOUT_MS; default 60000 si ausente o no numérico.
 */
export function getHybridApiTimeoutMs(): number {
  const raw = process.env.HYBRID_API_TIMEOUT_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : HYBRID_TIMEOUT_DEFAULT_MS;
  if (!Number.isFinite(n)) return HYBRID_TIMEOUT_DEFAULT_MS;
  return clampHybridTimeoutMs(n);
}

/**
 * Timeout para GET /ventas/:documento (~180 s; TDetalleVta puede tardar).
 * Siempre el máximo del rango permitido.
 */
export function getHybridDetailTimeoutMs(): number {
  return HYBRID_TIMEOUT_MAX_MS;
}

/** Clampa un timeout al rango [MIN, MAX]. */
export function clampHybridTimeoutMs(ms: number): number {
  if (!Number.isFinite(ms)) return HYBRID_TIMEOUT_DEFAULT_MS;
  return Math.min(
    HYBRID_TIMEOUT_MAX_MS,
    Math.max(HYBRID_TIMEOUT_MIN_MS, ms),
  );
}

/**
 * HYBRID_AUTH_HEADER=bearer → Authorization: Bearer …
 * HYBRID_AUTH_HEADER=x-api-key (o apikey / api-key) → X-API-Key: …
 */
export function getHybridAuthMode(): HybridAuthMode {
  const raw = (process.env.HYBRID_AUTH_HEADER ?? "bearer").trim().toLowerCase();
  if (raw === "x-api-key" || raw === "apikey" || raw === "api-key") {
    return "x-api-key";
  }
  return "bearer";
}

export function buildHybridAuthHeaders(token: string): Record<string, string> {
  if (getHybridAuthMode() === "x-api-key") {
    return { "X-API-Key": token, Accept: "application/json" };
  }
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}
