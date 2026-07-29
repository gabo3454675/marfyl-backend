/**
 * Remediación post-apply Plan B.
 * SUPERSEDE huérfanos ACTIVE (sourceHash null / ≠ planB) y alinea totalAmount = headerNet.
 * Sin InventoryMovement. Sin borrar filas.
 */

import { PLANB_SOURCE_HASH } from "./planb-reconcile.planner";

export const EXTRA_SOURCE_MISMATCH = "EXTRA_SOURCE_MISMATCH" as const;

export type RemediateSourceFac = {
  documentNumber: string;
  headerNet: string;
};

export type RemediateExistingInvoice = {
  id: number;
  legacyImportKey: string | null;
  totalAmount: string | number;
  deletedAt: Date | string | null;
};

export type RemediateExistingItem = {
  id: number;
  invoiceId: number;
  sourceHash: string | null;
  lineageStatus: string;
};

export type RemediateAction =
  | {
      action: "SUPERSEDE_ORPHAN";
      invoiceItemId: number;
      invoiceId: number;
      documentNumber: string;
      reason: typeof EXTRA_SOURCE_MISMATCH;
      sourceHash: string | null;
    }
  | {
      action: "UPDATE_TOTAL_HEADER_NET";
      invoiceId: number;
      documentNumber: string;
      fromTotal: string;
      toTotal: string;
    };

export type RemediateCounters = {
  orphansToSupersede: number;
  totalsToFix: number;
  totalsAlreadyOk: number;
  facInBatch: number;
  facFoundInDb: number;
  facMissingInDb: number;
  /** SUM(totalAmount) actual de FAC del lote encontradas en DB. */
  netBefore: string;
  /** SUM(headerNet) proyectado tras remediación (FAC encontradas). */
  netAfter: string;
  /** SUM(headerNet) del manifest completo del lote. */
  expectedNet: string;
};

export type RemediateResult = {
  sourceHash: string;
  counters: RemediateCounters;
  actions: RemediateAction[];
  supersedeItemIds: number[];
  totalUpdates: Array<{ invoiceId: number; totalAmount: string }>;
};

function moneyEq(a: string | number, b: string | number): boolean {
  return Number(a).toFixed(2) === Number(b).toFixed(2);
}

function moneySum(values: Array<string | number>): string {
  let n = 0;
  for (const v of values) n += Number(v);
  return n.toFixed(2);
}

function isOrphanActiveItem(
  item: RemediateExistingItem,
  planBHash: string,
): boolean {
  if (item.lineageStatus !== "ACTIVE") return false;
  return item.sourceHash == null || item.sourceHash !== planBHash;
}

/**
 * Plan puro de remediación post-apply.
 * Solo actúa sobre FAC del lote fuente presentes en DB (legacyImportKey FAC-{doc}).
 */
export function buildPlanBRemediation(input: {
  sourceHash?: string;
  facs: RemediateSourceFac[];
  existingInvoices: RemediateExistingInvoice[];
  existingItems: RemediateExistingItem[];
}): RemediateResult {
  const sourceHash = input.sourceHash ?? PLANB_SOURCE_HASH;
  const invoicesByLegacy = new Map<string, RemediateExistingInvoice>();
  for (const inv of input.existingInvoices) {
    if (inv.legacyImportKey) invoicesByLegacy.set(inv.legacyImportKey, inv);
  }

  const itemsByInvoice = new Map<number, RemediateExistingItem[]>();
  for (const it of input.existingItems) {
    const list = itemsByInvoice.get(it.invoiceId) ?? [];
    list.push(it);
    itemsByInvoice.set(it.invoiceId, list);
  }

  const actions: RemediateAction[] = [];
  const supersedeItemIds: number[] = [];
  const totalUpdates: Array<{ invoiceId: number; totalAmount: string }> = [];

  let orphansToSupersede = 0;
  let totalsToFix = 0;
  let totalsAlreadyOk = 0;
  let facFoundInDb = 0;
  let facMissingInDb = 0;
  const beforeAmounts: Array<string | number> = [];
  const afterAmounts: string[] = [];

  const expectedNet = moneySum(input.facs.map((f) => f.headerNet));

  for (const fac of input.facs) {
    const legacyKey = `FAC-${fac.documentNumber}`;
    const inv = invoicesByLegacy.get(legacyKey);
    if (!inv) {
      facMissingInDb += 1;
      continue;
    }
    facFoundInDb += 1;
    beforeAmounts.push(inv.totalAmount);
    afterAmounts.push(Number(fac.headerNet).toFixed(2));

    const items = itemsByInvoice.get(inv.id) ?? [];
    for (const it of items) {
      if (!isOrphanActiveItem(it, sourceHash)) continue;
      orphansToSupersede += 1;
      supersedeItemIds.push(it.id);
      actions.push({
        action: "SUPERSEDE_ORPHAN",
        invoiceItemId: it.id,
        invoiceId: inv.id,
        documentNumber: fac.documentNumber,
        reason: EXTRA_SOURCE_MISMATCH,
        sourceHash: it.sourceHash,
      });
    }

    const toTotal = Number(fac.headerNet).toFixed(2);
    if (!moneyEq(inv.totalAmount, toTotal)) {
      totalsToFix += 1;
      totalUpdates.push({ invoiceId: inv.id, totalAmount: toTotal });
      actions.push({
        action: "UPDATE_TOTAL_HEADER_NET",
        invoiceId: inv.id,
        documentNumber: fac.documentNumber,
        fromTotal: Number(inv.totalAmount).toFixed(2),
        toTotal,
      });
    } else {
      totalsAlreadyOk += 1;
    }
  }

  return {
    sourceHash,
    counters: {
      orphansToSupersede,
      totalsToFix,
      totalsAlreadyOk,
      facInBatch: input.facs.length,
      facFoundInDb,
      facMissingInDb,
      netBefore: moneySum(beforeAmounts),
      netAfter: moneySum(afterAmounts),
      expectedNet,
    },
    actions,
    supersedeItemIds,
    totalUpdates,
  };
}
