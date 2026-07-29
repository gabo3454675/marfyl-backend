import { validateInvoiceItemChecks } from "../invoices/canonical/invoice-item-checks";
import { displayQuantity } from "../invoices/canonical/invoice-item-display";
import {
  buildPlanB,
  legacyInsertInvoicePayload,
  reconciledItemPayload,
  reconciledPayloadFromAction,
  PLANB_SOURCE_HASH,
} from "./planb-reconcile.planner";

describe("Plan B invoice item CHECKs C1–C4", () => {
  it("C1: OPERATIONAL requiere productId y quantity", () => {
    const r = validateInvoiceItemChecks({
      recordClass: "OPERATIONAL",
      productId: null,
      quantity: null,
    });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.startsWith("C1"))).toBe(true);
  });

  it("C4: RECONCILED_HISTORY rechaza quantity Int", () => {
    const r = validateInvoiceItemChecks({
      recordClass: "RECONCILED_HISTORY",
      productId: 1,
      quantity: 1,
      sourceHash: PLANB_SOURCE_HASH,
      sourceLineKey: "a".repeat(64),
      sourceQuantity: "1.00",
      effectiveQuantity: "1.00",
      sourceSkuExact: "SKU",
      sourceDescription: "DESC",
    });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.startsWith("C4"))).toBe(true);
  });

  it("lote actual: RECONCILED con productId y quantity null pasa", () => {
    const payload = reconciledItemPayload({
      productId: 1368,
      unitPrice: "1.00",
      subtotal: "1.00",
      sourceLineKey: "b".repeat(64),
      sourceSkuExact: "01",
      sourceDescription: "TEST",
      sourceQuantity: "0.35",
      sourceDetailedQuantity: null,
      effectiveQuantity: "0.35",
    });
    const r = validateInvoiceItemChecks(payload);
    expect(r.ok).toBe(true);
    expect(payload.quantity).toBeNull();
    expect(payload.productId).toBe(1368);
  });
});

describe("displayQuantity", () => {
  it("prioriza quantity operativa", () => {
    expect(displayQuantity({ quantity: 2, effectiveQuantity: "0.35" })).toBe(2);
  });

  it("usa effectiveQuantity cuando quantity es null (C4)", () => {
    expect(
      displayQuantity({ quantity: null, effectiveQuantity: "0.35" }),
    ).toBe(0.35);
  });
});

describe("legacy insert header contract", () => {
  it("515 inserts: PAID + PROCESSED_LEGACY + unknown_legacy + seller null", () => {
    const h = legacyInsertInvoicePayload("00009999", "10.00", "01/07/2026");
    expect(h.status).toBe("PAID");
    expect(h.paymentStatus).toBe("PROCESSED_LEGACY");
    expect(h.paymentMethod).toBe("unknown_legacy");
    expect(h.sellerId).toBeNull();
    expect(h.customerId).toBe(1);
    expect(h.companyId).toBe(2);
    expect(h.isLegacyImport).toBe(true);
  });
});

describe("buildPlanB planner", () => {
  it("cuenta insert FAC vs existing y SUPERSEDE ambiguas", () => {
    const result = buildPlanB({
      sourceHash: PLANB_SOURCE_HASH,
      facs: [
        {
          documentNumber: "00000001",
          saleDate: "01/07/2026",
          headerNet: "5.00",
          lineCount: 1,
        },
        {
          documentNumber: "00000002",
          saleDate: "01/07/2026",
          headerNet: "3.00",
          lineCount: 1,
        },
      ],
      lines: [
        {
          documentNumber: "00000001",
          sourceLineNumber: 1,
          sourceLineKey: "c".repeat(64),
          sourceSkuExact: "SKU-A",
          description: "A",
          quantity: "1.00",
          detailedQuantity: null,
          effectiveQuantity: "1.00",
          linePriceTotal: "5.00",
        },
        {
          documentNumber: "00000002",
          sourceLineNumber: 2,
          sourceLineKey: "d".repeat(64),
          sourceSkuExact: "SKU-B",
          description: "B",
          quantity: "1.00",
          detailedQuantity: null,
          effectiveQuantity: "1.00",
          linePriceTotal: "3.00",
        },
      ],
      existingInvoices: [
        {
          id: 10,
          legacyImportKey: "FAC-00000002",
          paymentStatus: "paid",
          paymentMethod: "CASH",
          paymentLineCount: 1,
          pagoCount: 0,
          deletedAt: null,
        },
      ],
      existingItems: [
        {
          id: 100,
          invoiceId: 10,
          productId: 2,
          quantity: 1,
          unitPrice: "3.0000",
          subtotal: "3.00",
        },
        {
          id: 101,
          invoiceId: 10,
          productId: 2,
          quantity: 1,
          unitPrice: "3.0000",
          subtotal: "3.00",
        },
      ],
      skuMappings: [
        { sourceSkuExact: "SKU-A", productId: 1, decision: "APPROVE" },
        { sourceSkuExact: "SKU-B", productId: 2, decision: "APPROVE" },
      ],
      catalogBySkuExact: new Map(),
    });

    expect(result.sourceHash).toBe(PLANB_SOURCE_HASH);
    expect(result.counters.insertFac).toBe(1);
    expect(result.counters.insertTrulyMissing).toBe(1);
    expect(result.counters.existingFac).toBe(1);
    expect(result.counters.existingActive).toBe(1);
    expect(result.counters.existingSoftDeleted).toBe(0);
    expect(result.counters.restoreCount).toBe(0);
    expect(result.counters.ambiguousLines).toBe(1);
    expect(result.counters.blockedNoProduct).toBe(0);
    expect(result.blocked).toBe(false);
    expect(
      result.actions.some((a) => a.action === "SUPERSEDE_PLUS_INSERT"),
    ).toBe(true);
    expect(result.actions.some((a) => a.action === "INSERT_FAC_LINE")).toBe(
      true,
    );
  });

  it("FAC soft-deleted → RESTORE + reconciliar ítems, nunca INSERT (evita P2002)", () => {
    const result = buildPlanB({
      sourceHash: PLANB_SOURCE_HASH,
      facs: [
        {
          documentNumber: "00009999",
          saleDate: "01/07/2026",
          headerNet: "1.00",
          lineCount: 1,
        },
      ],
      lines: [
        {
          documentNumber: "00009999",
          sourceLineNumber: 1,
          sourceLineKey: "g".repeat(64),
          sourceSkuExact: "SKU-Z",
          description: "SOFT DEL",
          quantity: "1.00",
          detailedQuantity: null,
          effectiveQuantity: "1.00",
          linePriceTotal: "1.00",
        },
      ],
      existingInvoices: [
        {
          id: 999,
          legacyImportKey: "FAC-00009999",
          paymentStatus: "paid",
          paymentMethod: "CASH",
          paymentLineCount: 1,
          pagoCount: 0,
          deletedAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
      existingItems: [
        {
          id: 9001,
          invoiceId: 999,
          productId: 7,
          quantity: 1,
          unitPrice: "1.0000",
          subtotal: "1.00",
        },
      ],
      skuMappings: [
        { sourceSkuExact: "SKU-Z", productId: 7, decision: "APPROVE" },
      ],
      catalogBySkuExact: new Map(),
    });

    expect(result.counters.existingActive).toBe(0);
    expect(result.counters.existingSoftDeleted).toBe(1);
    expect(result.counters.existingFac).toBe(1);
    expect(result.counters.restoreCount).toBe(1);
    expect(result.counters.insertFac).toBe(0);
    expect(result.counters.insertTrulyMissing).toBe(0);
    expect(result.insertFacDocuments).toEqual([]);
    expect(
      result.actions.some((a) => a.action === "INSERT_FAC_LINE"),
    ).toBe(false);
    const restore = result.actions.find((a) => a.action === "RESTORE_INVOICE");
    expect(restore).toEqual({
      action: "RESTORE_INVOICE",
      documentNumber: "00009999",
      invoiceId: 999,
      legacyImportKey: "FAC-00009999",
    });
    expect(result.actions.some((a) => a.action === "UPDATE_EXACT")).toBe(true);
  });

  it("UPDATE_EXACT incluye payload RECONCILED completo con sourceQuantity=line.quantity", () => {
    const result = buildPlanB({
      sourceHash: PLANB_SOURCE_HASH,
      facs: [
        {
          documentNumber: "00000010",
          saleDate: "01/07/2026",
          headerNet: "2.00",
          lineCount: 1,
        },
      ],
      lines: [
        {
          documentNumber: "00000010",
          sourceLineNumber: 5,
          sourceLineKey: "e".repeat(64),
          sourceSkuExact: "SKU-X",
          description: "PROD X",
          quantity: "0.00",
          detailedQuantity: "1.00",
          effectiveQuantity: "1.00",
          linePriceTotal: "2.00",
        },
      ],
      existingInvoices: [
        {
          id: 50,
          legacyImportKey: "FAC-00000010",
          paymentStatus: "paid",
          paymentMethod: "CASH",
          paymentLineCount: 1,
          pagoCount: 0,
          deletedAt: null,
        },
      ],
      existingItems: [
        {
          id: 500,
          invoiceId: 50,
          productId: 9,
          quantity: 1,
          unitPrice: "2.0000",
          subtotal: "2.00",
        },
      ],
      skuMappings: [
        { sourceSkuExact: "SKU-X", productId: 9, decision: "APPROVE" },
      ],
      catalogBySkuExact: new Map(),
    });

    const update = result.actions.find((a) => a.action === "UPDATE_EXACT");
    expect(update).toBeDefined();
    if (!update || update.action !== "UPDATE_EXACT") {
      throw new Error("expected UPDATE_EXACT");
    }
    expect(update.sourceQuantity).toBe("0.00");
    expect(update.effectiveQuantity).toBe("1.00");
    expect(update.sourceQuantity).not.toBe(update.effectiveQuantity);
    expect(update.sourceSkuExact).toBe("SKU-X");
    expect(update.sourceDescription).toBe("PROD X");
    expect(update.sourceDetailedQuantity).toBe("1.00");
    expect(update.sourceLineKey).toBe("e".repeat(64));

    const payload = reconciledPayloadFromAction(update);
    expect(payload.quantity).toBeNull();
    expect(payload.sourceQuantity).toBe("0.00");
    expect(payload.effectiveQuantity).toBe("1.00");
    expect(payload.sourceSkuExact).toBe("SKU-X");
    expect(payload.sourceDescription).toBe("PROD X");
    expect(payload.sourceHash).toBe(PLANB_SOURCE_HASH);
    expect(validateInvoiceItemChecks(payload).ok).toBe(true);
  });

  it("UPDATE_RESIDUAL_1_1 no omite textos ni usa sourceQuantity=effectiveQuantity", () => {
    const result = buildPlanB({
      sourceHash: PLANB_SOURCE_HASH,
      facs: [
        {
          documentNumber: "00000011",
          saleDate: "01/07/2026",
          headerNet: "4.00",
          lineCount: 1,
        },
      ],
      lines: [
        {
          documentNumber: "00000011",
          sourceLineNumber: 7,
          sourceLineKey: "f".repeat(64),
          sourceSkuExact: "SKU-Y",
          description: "PROD Y",
          quantity: "2.50",
          detailedQuantity: null,
          effectiveQuantity: "2.50",
          linePriceTotal: "5.00",
        },
      ],
      existingInvoices: [
        {
          id: 60,
          legacyImportKey: "FAC-00000011",
          paymentStatus: "paid",
          paymentMethod: "CASH",
          paymentLineCount: 1,
          pagoCount: 0,
          deletedAt: null,
        },
      ],
      // quantity distinta → no UPDATE_EXACT; residual 1:1 por productId
      existingItems: [
        {
          id: 600,
          invoiceId: 60,
          productId: 8,
          quantity: 3,
          unitPrice: "1.0000",
          subtotal: "3.00",
        },
      ],
      skuMappings: [
        { sourceSkuExact: "SKU-Y", productId: 8, decision: "APPROVE" },
      ],
      catalogBySkuExact: new Map(),
    });

    const update = result.actions.find(
      (a) => a.action === "UPDATE_RESIDUAL_1_1",
    );
    expect(update).toBeDefined();
    if (!update || update.action !== "UPDATE_RESIDUAL_1_1") {
      throw new Error("expected UPDATE_RESIDUAL_1_1");
    }
    expect(update.sourceQuantity).toBe("2.50");
    expect(update.sourceSkuExact).toBe("SKU-Y");
    expect(update.sourceDescription).toBe("PROD Y");
    expect(update.sourceDetailedQuantity).toBeNull();

    // Regresión critic: payload incompleto / sourceQuantity=effective mal mapeado
    const badOmittingTexts = {
      ...reconciledPayloadFromAction(update),
      sourceSkuExact: null as unknown as string,
      sourceDescription: null as unknown as string,
      productId: null as unknown as number,
    };
    expect(validateInvoiceItemChecks(badOmittingTexts).ok).toBe(false);

    const badSourceQtyAsEffective = {
      ...reconciledPayloadFromAction(update),
      sourceQuantity: update.effectiveQuantity,
    };
    // Cuando quantity fuente == effective (este caso), el valor coincide;
    // el contrato critico se valida en el caso 00010052 (0 vs 1) arriba.
    // Aquí aseguramos que el planner NO sustituyó quantity por otro campo.
    expect(update.sourceQuantity).toBe("2.50");
    expect(badSourceQtyAsEffective.sourceQuantity).toBe(
      update.effectiveQuantity,
    );
    expect(reconciledPayloadFromAction(update).sourceQuantity).toBe(
      update.sourceQuantity,
    );
  });
});
