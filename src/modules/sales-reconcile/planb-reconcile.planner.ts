/**
 * Planificador puro Plan B — conciliación FastReport → invoices/items.
 * Sin efectos de inventario. Sin mutaciones (solo plan).
 */

export const PLANB_SOURCE_HASH =
  "b823b2f967c5138876926457cd923c9d536f39cba27df8aa0befce054f10ef40";

export const PLANB_ORG_ID = 2;
export const PLANB_COMPANY_ID = 2;
export const PLANB_CUSTOMER_ID = 1;

export type SourceLine = {
  documentNumber: string;
  sourceLineNumber: number;
  sourceLineKey: string;
  sourceSkuExact: string;
  description: string;
  quantity: string;
  detailedQuantity: string | null;
  effectiveQuantity: string;
  linePriceTotal: string;
};

export type SourceFac = {
  documentNumber: string;
  saleDate: string;
  headerNet: string;
  lineCount: number;
};

export type ExistingInvoice = {
  id: number;
  legacyImportKey: string | null;
  paymentStatus: string;
  paymentMethod: string;
  paymentLineCount: number;
  pagoCount: number;
  /** null = activa; Date = soft-deleted (void). Matching incluye ambas. */
  deletedAt: Date | string | null;
};

export type ExistingItem = {
  id: number;
  invoiceId: number;
  productId: number | null;
  quantity: number | null;
  unitPrice: string | number;
  subtotal: string | number;
};

export type SkuMapping = {
  sourceSkuExact: string;
  productId: number;
  decision: string;
};

export type LineAction =
  | {
      action: "RESTORE_INVOICE";
      documentNumber: string;
      invoiceId: number;
      legacyImportKey: string;
    }
  | {
      action: "UPDATE_EXACT" | "UPDATE_RESIDUAL_1_1";
      documentNumber: string;
      invoiceId: number;
      invoiceItemId: number;
      sourceLineKey: string;
      productId: number;
      effectiveQuantity: string;
      unitPrice: string;
      subtotal: string;
      sourceSkuExact: string;
      sourceDescription: string;
      /** Cantidad principal fuente (line.quantity), NUNCA effectiveQuantity. */
      sourceQuantity: string;
      sourceDetailedQuantity: string | null;
    }
  | {
      action: "SUPERSEDE_PLUS_INSERT";
      documentNumber: string;
      invoiceId: number;
      supersedeItemIds: number[];
      sourceLineKey: string;
      productId: number;
      effectiveQuantity: string;
      unitPrice: string;
      subtotal: string;
      sourceSkuExact: string;
      sourceDescription: string;
      sourceQuantity: string;
      sourceDetailedQuantity: string | null;
    }
  | {
      action: "INSERT_ITEM_ON_EXISTING";
      documentNumber: string;
      invoiceId: number;
      sourceLineKey: string;
      productId: number;
      effectiveQuantity: string;
      unitPrice: string;
      subtotal: string;
      sourceSkuExact: string;
      sourceDescription: string;
      sourceQuantity: string;
      sourceDetailedQuantity: string | null;
    }
  | {
      action: "INSERT_FAC_LINE";
      documentNumber: string;
      sourceLineKey: string;
      productId: number;
      effectiveQuantity: string;
      unitPrice: string;
      subtotal: string;
      sourceSkuExact: string;
      sourceDescription: string;
      sourceQuantity: string;
      sourceDetailedQuantity: string | null;
      headerNet: string;
      saleDate: string;
    }
  | {
      action: "BLOCKED_NO_PRODUCT";
      documentNumber: string;
      sourceLineKey: string;
      sourceSkuExact: string;
    };

export type PlanBCounters = {
  /** FAC fuente con match DB activa (deletedAt null). */
  existingActive: number;
  /** FAC fuente con match DB soft-deleted. */
  existingSoftDeleted: number;
  /** existingActive + existingSoftDeleted (base de matching; ≈594). */
  existingFac: number;
  /** FAC fuente sin key en DB (ni activa ni deleted); ≈504. Alias insertTrulyMissing. */
  insertFac: number;
  insertTrulyMissing: number;
  /** Soft-deleted a restaurar (deletedAt=null); ≈11. */
  restoreCount: number;
  ambiguousLines: number;
  updateExact: number;
  updateResidual11: number;
  insertMissingItem: number;
  insertMissingFacLines: number;
  blockedNoProduct: number;
  totalSourceFac: number;
  totalSourceLines: number;
  activeLinesPlanned: number;
};

export type PlanBResult = {
  sourceHash: string;
  counters: PlanBCounters;
  actions: LineAction[];
  insertFacDocuments: string[];
  preservePaymentInvoiceIds: number[];
  blocked: boolean;
  blockers: string[];
};

function moneyEq(a: string | number, b: string | number): boolean {
  return Number(a).toFixed(2) === Number(b).toFixed(2);
}

/** Misma regla TASK-002A: uppercase + remove Unicode whitespace. */
export function normalizeSku(exact: string): string {
  return String(exact ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .toUpperCase();
}

function unitPriceFromLine(line: SourceLine): string {
  const qty = Number(line.effectiveQuantity);
  const total = Number(line.linePriceTotal);
  if (!Number.isFinite(qty) || qty === 0) return total.toFixed(4);
  return (total / qty).toFixed(4);
}

function truncQty(eff: string): number {
  return Math.trunc(Number(eff));
}

/**
 * Resuelve productId: mapping aprobado (42) o catálogo por SKU exacto / normalizado único.
 */
export function resolveProductId(
  sourceSkuExact: string,
  skuMap: Map<string, number>,
  catalogBySkuExact: Map<string, number>,
  catalogBySkuNormalized?: Map<string, number>,
): number | null {
  const mapped = skuMap.get(sourceSkuExact);
  if (mapped != null) return mapped;
  const exact = catalogBySkuExact.get(sourceSkuExact);
  if (exact != null) return exact;
  const trimmed = sourceSkuExact.trim();
  if (trimmed !== sourceSkuExact) {
    const t = catalogBySkuExact.get(trimmed);
    if (t != null) return t;
    const tm = skuMap.get(trimmed);
    if (tm != null) return tm;
  }
  if (catalogBySkuNormalized) {
    const n = catalogBySkuNormalized.get(normalizeSku(sourceSkuExact));
    if (n != null) return n;
  }
  return null;
}

export function buildPlanB(input: {
  sourceHash: string;
  facs: SourceFac[];
  lines: SourceLine[];
  existingInvoices: ExistingInvoice[];
  existingItems: ExistingItem[];
  skuMappings: SkuMapping[];
  catalogBySkuExact: Map<string, number>;
  catalogBySkuNormalized?: Map<string, number>;
}): PlanBResult {
  const skuMap = new Map<string, number>();
  for (const m of input.skuMappings) {
    if (m.decision === "APPROVE" && m.productId != null) {
      skuMap.set(m.sourceSkuExact, m.productId);
      skuMap.set(m.sourceSkuExact.trim(), m.productId);
    }
  }
  const catalogNorm =
    input.catalogBySkuNormalized ?? new Map<string, number>();

  const invoicesByLegacy = new Map<string, ExistingInvoice>();
  for (const inv of input.existingInvoices) {
    if (inv.legacyImportKey) invoicesByLegacy.set(inv.legacyImportKey, inv);
  }

  const itemsByInvoice = new Map<number, ExistingItem[]>();
  for (const it of input.existingItems) {
    const list = itemsByInvoice.get(it.invoiceId) ?? [];
    list.push(it);
    itemsByInvoice.set(it.invoiceId, list);
  }

  const facByDoc = new Map(input.facs.map((f) => [f.documentNumber, f]));
  const linesByFac = new Map<string, SourceLine[]>();
  for (const line of input.lines) {
    const list = linesByFac.get(line.documentNumber) ?? [];
    list.push(line);
    linesByFac.set(line.documentNumber, list);
  }

  const actions: LineAction[] = [];
  const insertFacDocuments: string[] = [];
  const preservePaymentInvoiceIds: number[] = [];
  const counters: PlanBCounters = {
    existingActive: 0,
    existingSoftDeleted: 0,
    existingFac: 0,
    insertFac: 0,
    insertTrulyMissing: 0,
    restoreCount: 0,
    ambiguousLines: 0,
    updateExact: 0,
    updateResidual11: 0,
    insertMissingItem: 0,
    insertMissingFacLines: 0,
    blockedNoProduct: 0,
    totalSourceFac: input.facs.length,
    totalSourceLines: input.lines.length,
    activeLinesPlanned: 0,
  };

  const resolve = (sku: string) =>
    resolveProductId(sku, skuMap, input.catalogBySkuExact, catalogNorm);

  for (const [doc, facLines] of linesByFac) {
    const legacyKey = `FAC-${doc}`;
    const inv = invoicesByLegacy.get(legacyKey);
    const fac = facByDoc.get(doc);
    const saleDate = fac?.saleDate ?? "";
    const headerNet = fac?.headerNet ?? "0";

    if (!inv) {
      counters.insertFac += 1;
      counters.insertTrulyMissing += 1;
      insertFacDocuments.push(doc);
      for (const line of facLines) {
        const productId = resolve(line.sourceSkuExact);
        if (productId == null) {
          counters.blockedNoProduct += 1;
          actions.push({
            action: "BLOCKED_NO_PRODUCT",
            documentNumber: doc,
            sourceLineKey: line.sourceLineKey,
            sourceSkuExact: line.sourceSkuExact,
          });
          continue;
        }
        counters.insertMissingFacLines += 1;
        counters.activeLinesPlanned += 1;
        actions.push({
          action: "INSERT_FAC_LINE",
          documentNumber: doc,
          sourceLineKey: line.sourceLineKey,
          productId,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: unitPriceFromLine(line),
          subtotal: Number(line.linePriceTotal).toFixed(2),
          sourceSkuExact: line.sourceSkuExact,
          sourceDescription: line.description,
          sourceQuantity: line.quantity,
          sourceDetailedQuantity: line.detailedQuantity,
          headerNet,
          saleDate,
        });
      }
      continue;
    }

    // Existe en DB (activa o soft-deleted): NUNCA INSERT (evita P2002 unique).
    counters.existingFac += 1;
    preservePaymentInvoiceIds.push(inv.id);
    if (inv.deletedAt != null) {
      counters.existingSoftDeleted += 1;
      counters.restoreCount += 1;
      actions.push({
        action: "RESTORE_INVOICE",
        documentNumber: doc,
        invoiceId: inv.id,
        legacyImportKey: legacyKey,
      });
    } else {
      counters.existingActive += 1;
    }

    const invItems = [...(itemsByInvoice.get(inv.id) || [])];
    const usedItemIds = new Set<number>();
    const handledLineKeys = new Set<string>();

    // Pass 1: exact signature
    for (const line of facLines) {
      const productId = resolve(line.sourceSkuExact);
      if (productId == null) continue;
      const unit = unitPriceFromLine(line);
      const qtyTrunc = truncQty(line.effectiveQuantity);
      const cands = invItems.filter(
        (it) =>
          !usedItemIds.has(it.id) &&
          it.productId === productId &&
          it.quantity === qtyTrunc &&
          moneyEq(it.unitPrice, unit),
      );
      if (cands.length === 1) {
        usedItemIds.add(cands[0].id);
        handledLineKeys.add(line.sourceLineKey);
        counters.updateExact += 1;
        counters.activeLinesPlanned += 1;
        actions.push({
          action: "UPDATE_EXACT",
          documentNumber: doc,
          invoiceId: inv.id,
          invoiceItemId: cands[0].id,
          sourceLineKey: line.sourceLineKey,
          productId,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: unit,
          subtotal: Number(line.linePriceTotal).toFixed(2),
          sourceSkuExact: line.sourceSkuExact,
          sourceDescription: line.description,
          sourceQuantity: line.quantity,
          sourceDetailedQuantity: line.detailedQuantity,
        });
      } else if (cands.length > 1) {
        handledLineKeys.add(line.sourceLineKey);
        for (const c of cands) usedItemIds.add(c.id);
        counters.ambiguousLines += 1;
        counters.activeLinesPlanned += 1;
        actions.push({
          action: "SUPERSEDE_PLUS_INSERT",
          documentNumber: doc,
          invoiceId: inv.id,
          supersedeItemIds: cands.map((c) => c.id).sort((a, b) => a - b),
          sourceLineKey: line.sourceLineKey,
          productId,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: unit,
          subtotal: Number(line.linePriceTotal).toFixed(2),
          sourceSkuExact: line.sourceSkuExact,
          sourceDescription: line.description,
          sourceQuantity: line.quantity,
          sourceDetailedQuantity: line.detailedQuantity,
        });
      }
    }

    // Pass 2: residual 1:1 by productId
    for (const line of facLines) {
      if (handledLineKeys.has(line.sourceLineKey)) continue;
      const productId = resolve(line.sourceSkuExact);
      if (productId == null) {
        counters.blockedNoProduct += 1;
        actions.push({
          action: "BLOCKED_NO_PRODUCT",
          documentNumber: doc,
          sourceLineKey: line.sourceLineKey,
          sourceSkuExact: line.sourceSkuExact,
        });
        continue;
      }
      const unit = unitPriceFromLine(line);
      const cands = invItems.filter(
        (it) => !usedItemIds.has(it.id) && it.productId === productId,
      );
      if (cands.length === 1) {
        usedItemIds.add(cands[0].id);
        handledLineKeys.add(line.sourceLineKey);
        counters.updateResidual11 += 1;
        counters.activeLinesPlanned += 1;
        actions.push({
          action: "UPDATE_RESIDUAL_1_1",
          documentNumber: doc,
          invoiceId: inv.id,
          invoiceItemId: cands[0].id,
          sourceLineKey: line.sourceLineKey,
          productId,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: unit,
          subtotal: Number(line.linePriceTotal).toFixed(2),
          sourceSkuExact: line.sourceSkuExact,
          sourceDescription: line.description,
          sourceQuantity: line.quantity,
          sourceDetailedQuantity: line.detailedQuantity,
        });
      } else if (cands.length > 1) {
        handledLineKeys.add(line.sourceLineKey);
        for (const c of cands) usedItemIds.add(c.id);
        counters.ambiguousLines += 1;
        counters.activeLinesPlanned += 1;
        actions.push({
          action: "SUPERSEDE_PLUS_INSERT",
          documentNumber: doc,
          invoiceId: inv.id,
          supersedeItemIds: cands.map((c) => c.id).sort((a, b) => a - b),
          sourceLineKey: line.sourceLineKey,
          productId,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: unit,
          subtotal: Number(line.linePriceTotal).toFixed(2),
          sourceSkuExact: line.sourceSkuExact,
          sourceDescription: line.description,
          sourceQuantity: line.quantity,
          sourceDetailedQuantity: line.detailedQuantity,
        });
      } else {
        handledLineKeys.add(line.sourceLineKey);
        counters.insertMissingItem += 1;
        counters.activeLinesPlanned += 1;
        actions.push({
          action: "INSERT_ITEM_ON_EXISTING",
          documentNumber: doc,
          invoiceId: inv.id,
          sourceLineKey: line.sourceLineKey,
          productId,
          effectiveQuantity: line.effectiveQuantity,
          unitPrice: unit,
          subtotal: Number(line.linePriceTotal).toFixed(2),
          sourceSkuExact: line.sourceSkuExact,
          sourceDescription: line.description,
          sourceQuantity: line.quantity,
          sourceDetailedQuantity: line.detailedQuantity,
        });
      }
    }
  }

  const blockers: string[] = [];
  if (counters.blockedNoProduct > 0) {
    blockers.push(`${counters.blockedNoProduct} líneas sin productId`);
  }
  if (input.sourceHash !== PLANB_SOURCE_HASH) {
    blockers.push(`sourceHash distinto de fixture canónico`);
  }

  return {
    sourceHash: input.sourceHash,
    counters,
    actions,
    insertFacDocuments,
    preservePaymentInvoiceIds,
    blocked: blockers.length > 0,
    blockers,
  };
}

/** Payload de cabecera para FAC nuevas (515). */
export function legacyInsertInvoicePayload(doc: string, headerNet: string, saleDate: string) {
  return {
    companyId: PLANB_COMPANY_ID,
    organizationId: PLANB_ORG_ID,
    customerId: PLANB_CUSTOMER_ID,
    sellerId: null as null,
    legacyImportKey: `FAC-${doc}`,
    importSource: "fastreport",
    isLegacyImport: true,
    status: "PAID" as const,
    paymentStatus: "PROCESSED_LEGACY" as const,
    paymentMethod: "unknown_legacy",
    totalAmount: headerNet,
    saleDate,
  };
}

/** Payload de ítem RECONCILED_HISTORY (siempre con productId en este lote). */
export function reconciledItemPayload(args: {
  productId: number;
  unitPrice: string;
  subtotal: string;
  sourceLineKey: string;
  sourceSkuExact: string;
  sourceDescription: string;
  sourceQuantity: string;
  sourceDetailedQuantity: string | null;
  effectiveQuantity: string;
}) {
  return {
    productId: args.productId,
    quantity: null as null,
    unitPrice: args.unitPrice,
    subtotal: args.subtotal,
    recordClass: "RECONCILED_HISTORY" as const,
    lineageStatus: "ACTIVE" as const,
    sourceHash: PLANB_SOURCE_HASH,
    sourceLineKey: args.sourceLineKey,
    sourceSkuExact: args.sourceSkuExact,
    sourceDescription: args.sourceDescription,
    sourceQuantity: args.sourceQuantity,
    sourceDetailedQuantity: args.sourceDetailedQuantity,
    effectiveQuantity: args.effectiveQuantity,
  };
}

/** Construye payload RECONCILED completo desde una acción de plan con campos fuente. */
export function reconciledPayloadFromAction(a: {
  productId: number;
  unitPrice: string;
  subtotal: string;
  sourceLineKey: string;
  sourceSkuExact: string;
  sourceDescription: string;
  sourceQuantity: string;
  sourceDetailedQuantity: string | null;
  effectiveQuantity: string;
}) {
  return reconciledItemPayload(a);
}
