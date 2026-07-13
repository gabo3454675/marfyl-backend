import {
  computeInvoiceTax,
  computeInvoiceTaxFromGross,
  computeLineTax,
  computeWithholdingIva,
  IVA_GENERAL_RATE,
} from "./tax-calculator";

describe("tax-calculator", () => {
  it("calcula IVA 16% en linea general", () => {
    const r = computeLineTax({ amount: 100 });
    expect(r.taxRate).toBe(IVA_GENERAL_RATE);
    expect(r.ivaLine).toBe(16);
    expect(r.taxableBase).toBe(100);
  });

  it("exento no genera IVA", () => {
    const r = computeLineTax({ amount: 50, isExempt: true });
    expect(r.ivaLine).toBe(0);
    expect(r.bucket).toBe("exempt");
  });

  it("total factura incluye IVA", () => {
    const t = computeInvoiceTax([
      { amount: 100, isExempt: false },
      { amount: 20, isExempt: true },
    ]);
    expect(t.subtotal).toBe(120);
    expect(t.ivaAmount).toBe(16);
    expect(t.totalWithTax).toBe(136);
  });

  it("retencion 75% del IVA", () => {
    expect(computeWithholdingIva(100)).toBe(75);
  });

  it("desglosa IVA desde precio bruto legacy POS", () => {
    const t = computeInvoiceTaxFromGross([
      { amount: 116, isExempt: false },
      { amount: 10, isExempt: true },
    ]);
    expect(t.totalWithTax).toBe(126);
    expect(t.ivaAmount).toBe(16);
    expect(t.baseGeneral).toBe(100);
    expect(t.baseExempt).toBe(10);
  });
});
