/**
 * Safe numeric conversion for Prisma Decimal values and unknown types.
 * Handles null, Prisma Decimal objects (via toNumber), and standard numeric conversion.
 */
export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: () => number }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
