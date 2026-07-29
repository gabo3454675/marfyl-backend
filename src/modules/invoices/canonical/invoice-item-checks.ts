/**
 * Validación app-layer de CHECKs C1–C4 (espejo de la migración).
 * No sustituye constraints DB; sirve para fail-closed antes de escribir.
 */

export type InvoiceItemCheckInput = {
  recordClass: "OPERATIONAL" | "RECONCILED_HISTORY";
  productId?: number | null;
  quantity?: number | null;
  sourceHash?: string | null;
  sourceLineKey?: string | null;
  sourceSkuExact?: string | null;
  sourceDescription?: string | null;
  sourceQuantity?: string | number | null;
  effectiveQuantity?: string | number | null;
};

export type InvoiceItemCheckResult = {
  ok: boolean;
  violations: string[];
};

function nonEmpty(s: string | null | undefined): boolean {
  return s != null && s.trim().length > 0;
}

export function validateInvoiceItemChecks(
  input: InvoiceItemCheckInput,
): InvoiceItemCheckResult {
  const violations: string[] = [];

  // C1
  if (input.recordClass === "OPERATIONAL") {
    if (input.productId == null) violations.push("C1: OPERATIONAL requiere productId");
    if (input.quantity == null) violations.push("C1: OPERATIONAL requiere quantity");
  }

  // C2
  if (input.recordClass === "RECONCILED_HISTORY") {
    if (!nonEmpty(input.sourceHash)) violations.push("C2: falta sourceHash");
    if (!nonEmpty(input.sourceLineKey) || input.sourceLineKey!.trim().length !== 64) {
      violations.push("C2: sourceLineKey debe tener 64 chars");
    }
    if (input.sourceQuantity == null) violations.push("C2: falta sourceQuantity");
    if (input.effectiveQuantity == null) {
      violations.push("C2: falta effectiveQuantity");
    }
    const hasProduct = input.productId != null;
    const hasTexts =
      nonEmpty(input.sourceSkuExact) && nonEmpty(input.sourceDescription);
    if (!hasProduct && !hasTexts) {
      violations.push("C2: productId o (sourceSkuExact+sourceDescription)");
    }
  }

  // C3
  if (input.productId == null) {
    if (!nonEmpty(input.sourceSkuExact) || !nonEmpty(input.sourceDescription)) {
      violations.push("C3: productId null exige sourceSkuExact y sourceDescription");
    }
  }

  // C4
  if (input.recordClass === "RECONCILED_HISTORY" && input.quantity != null) {
    violations.push("C4: RECONCILED_HISTORY exige quantity NULL");
  }

  return { ok: violations.length === 0, violations };
}
