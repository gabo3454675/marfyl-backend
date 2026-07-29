import {
  displayQuantity,
  mapInvoiceItemDisplay,
} from "./invoice-item-display";

describe("mapInvoiceItemDisplay", () => {
  it("expone displayQuantity, displayName y displaySku desde product", () => {
    const mapped = mapInvoiceItemDisplay({
      quantity: 2,
      effectiveQuantity: null,
      product: { name: "Ron", sku: "RON-1" },
      sourceDescription: "legacy",
      sourceSkuExact: "LEG-1",
    });
    expect(mapped.displayQuantity).toBe(2);
    expect(mapped.displayName).toBe("Ron");
    expect(mapped.displaySku).toBe("RON-1");
  });

  it("usa sourceDescription/sourceSkuExact si no hay product", () => {
    const mapped = mapInvoiceItemDisplay({
      quantity: null,
      effectiveQuantity: "1.5",
      product: null,
      sourceDescription: "Whisky",
      sourceSkuExact: "W-9",
    });
    expect(mapped.displayQuantity).toBe(1.5);
    expect(mapped.displayName).toBe("Whisky");
    expect(mapped.displaySku).toBe("W-9");
  });

  it("displayQuantity prioriza quantity sobre effectiveQuantity", () => {
    expect(
      displayQuantity({ quantity: 3, effectiveQuantity: "9" }),
    ).toBe(3);
  });
});
