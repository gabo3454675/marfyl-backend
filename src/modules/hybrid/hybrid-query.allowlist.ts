/**
 * Allowlists de query hacia Hybrid.
 * Solo estas claves se reenvían; el resto se descarta.
 */

export const HYBRID_LIST_QUERY_KEYS = ["q", "limit", "offset"] as const;

export const HYBRID_EXISTENCIA_QUERY_KEYS = [
  "codigo",
  "limit",
  "offset",
] as const;

export const HYBRID_VENTAS_QUERY_KEYS = [
  "q",
  "desde",
  "hasta",
  "campo_fecha",
  "documento",
  "numero_control",
  "tipo",
  "status",
  "visible",
  "rif",
  "nit",
  "usuario",
  "deposito",
  "moneda",
  "caja",
  "serie",
  "documento_origen",
  "limit",
  "offset",
] as const;

export const HYBRID_VENTA_DETAIL_QUERY_KEYS = ["limit", "offset"] as const;

export type HybridQueryInput = Record<string, unknown> | undefined;

/**
 * Extrae solo claves allowlisted y las serializa a string.
 * No inventa valores; omite vacíos / null / undefined.
 */
export function pickAllowlistedQuery(
  query: HybridQueryInput,
  allowed: readonly string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!query) return out;

  for (const key of allowed) {
    const value = query[key];
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      const first = value[0];
      if (first === undefined || first === null) continue;
      const s = String(first).trim();
      if (s === "") continue;
      out[key] = s;
      continue;
    }

    const s = String(value).trim();
    if (s === "") continue;
    out[key] = s;
  }

  return out;
}
