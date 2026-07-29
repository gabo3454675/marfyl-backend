import { validateInvoiceItemChecks } from "./invoice-item-checks";

describe("invoice-item-checks C2/C3", () => {
  it("C3: productId null exige textos", () => {
    const r = validateInvoiceItemChecks({
      recordClass: "RECONCILED_HISTORY",
      productId: null,
      quantity: null,
      sourceHash: "h".repeat(64),
      sourceLineKey: "k".repeat(64),
      sourceQuantity: "1",
      effectiveQuantity: "1",
      sourceSkuExact: null,
      sourceDescription: null,
    });
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.startsWith("C3") || v.includes("C2"))).toBe(
      true,
    );
  });
});
