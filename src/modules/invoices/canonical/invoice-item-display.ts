import { Decimal } from "@prisma/client/runtime/library";

export type DisplayQuantitySource = {
  quantity?: number | null;
  effectiveQuantity?: Decimal | string | number | null;
};

/**
 * Cantidad canónica de display.
 * Con C4, RECONCILED_HISTORY siempre usa effectiveQuantity.
 */
export function displayQuantity(item: DisplayQuantitySource): number {
  if (item.quantity != null && Number.isFinite(Number(item.quantity))) {
    return Number(item.quantity);
  }
  if (item.effectiveQuantity == null) return 0;
  return Number(item.effectiveQuantity);
}

export function displayQuantitySqlExpr(alias = "ii"): string {
  return `COALESCE(${alias}.quantity::numeric, ${alias}."effectiveQuantity")`;
}

export function isActiveLineage(
  lineageStatus: string | null | undefined,
): boolean {
  return lineageStatus == null || lineageStatus === "ACTIVE";
}
