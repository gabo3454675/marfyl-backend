/**
 * Orígenes permitidos para CORS y validación CSRF (deben coincidir).
 */
export function parseExtraOrigins(raw?: string): string[] {
  return (raw ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function buildCsrfAllowedOrigins(
  frontendUrl: string,
  extraOrigins: string[] = [],
): string[] {
  const origins = new Set<string>([
    frontendUrl,
    ...extraOrigins,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
  ]);
  return [...origins].filter(Boolean);
}

/** Mismo criterio que CORS en main.ts: lista explícita + hostnames MARFYL/Render. */
export function isMarfylAllowedOrigin(
  origin: string,
  allowedOrigins: string[],
): boolean {
  const normalized = origin.replace(/\/$/, "");
  const inList = allowedOrigins.some(
    (allowed) => allowed.replace(/\/$/, "") === normalized,
  );
  if (inList) return true;

  try {
    const h = new URL(origin).hostname;
    return (
      h === "marfyl.site" ||
      h.endsWith(".marfyl.site") ||
      (h.endsWith(".onrender.com") &&
        h.startsWith("marfyl-") &&
        h.includes("-frontend"))
    );
  } catch {
    return false;
  }
}
