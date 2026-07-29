import { Decimal } from "@prisma/client/runtime/library";

export type DisplayQuantitySource = {
  quantity?: number | null;
  effectiveQuantity?: Decimal | string | number | null;
};

export type DisplayItemSource = DisplayQuantitySource & {
  product?: { name?: string | null; sku?: string | null } | null;
  sourceDescription?: string | null;
  sourceSkuExact?: string | null;
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

/** Campos de display canónicos (findOne / getHistory / public token). */
export function mapInvoiceItemDisplay<T extends DisplayItemSource>(item: T) {
  return {
    ...item,
    displayQuantity: displayQuantity(item),
    displayName: item.product?.name ?? item.sourceDescription ?? "Producto",
    displaySku: item.product?.sku ?? item.sourceSkuExact ?? null,
  };
}

export function displayQuantitySqlExpr(alias = "ii"): string {
  return `COALESCE(${alias}.quantity::numeric, ${alias}."effectiveQuantity")`;
}

export function isActiveLineage(
  lineageStatus: string | null | undefined,
): boolean {
  return lineageStatus == null || lineageStatus === "ACTIVE";
}
