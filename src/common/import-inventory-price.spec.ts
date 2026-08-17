import { resolveImportSalePrice } from "./import-inventory-price";

describe("resolveImportSalePrice", () => {
  it("keeps positive prices", () => {
    expect(resolveImportSalePrice(12.5, false)).toBe(12.5);
    expect(resolveImportSalePrice("9,99", true)).toBe(9.99);
  });

  it("skips zero/invalid when allowZeroPrice is off", () => {
    expect(resolveImportSalePrice(0, false)).toBeNull();
    expect(resolveImportSalePrice(null, false)).toBeNull();
    expect(resolveImportSalePrice("", false)).toBeNull();
    expect(resolveImportSalePrice(-1, false)).toBeNull();
  });

  it("coerces zero/invalid to 0 when allowZeroPrice is on", () => {
    expect(resolveImportSalePrice(0, true)).toBe(0);
    expect(resolveImportSalePrice(null, true)).toBe(0);
    expect(resolveImportSalePrice("", true)).toBe(0);
    expect(resolveImportSalePrice(-1, true)).toBe(0);
  });
});
