/**
 * Resuelve precio de venta para import de inventario.
 * Por defecto omite NaN/<=0 (retorna null).
 * Con allowZeroPrice: NaN / <0 / 0 → 0 (incluye la fila).
 */
export function resolveImportSalePrice(
  raw: unknown,
  allowZeroPrice: boolean,
): number | null {
  const price = parseNumber(raw);
  if (!Number.isNaN(price) && price > 0) return price;
  if (allowZeroPrice) return 0;
  return null;
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;
  const s = String(value).replace(",", ".").trim();
  return parseFloat(s);
}
