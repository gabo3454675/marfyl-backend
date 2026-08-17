import {
  accompanimentBomOnly,
  bomLinesForStock,
  collectSaleStockNeeds,
  deductsParentStock,
  findBottleInBom,
  findUnstockableBomNeed,
  resolveSaleMode,
  unstockableBomNeedMessage,
} from "./sale-mode-stock";
import { explodeBom, mergeBomNeeds } from "./bundle-bom";

describe("sale-mode-stock", () => {
  it("resolveSaleMode default STANDARD", () => {
    expect(resolveSaleMode(undefined)).toBe("STANDARD");
    expect(resolveSaleMode(null)).toBe("STANDARD");
    expect(resolveSaleMode("NORMAL")).toBe("STANDARD");
    expect(resolveSaleMode("DESCORCHE")).toBe("DESCORCHE");
    expect(resolveSaleMode("COMBO")).toBe("COMBO");
  });

  it("deductsParentStock: solo producto suelto (no combo ni servicio)", () => {
    expect(deductsParentStock({ isBundle: true, isService: false })).toBe(false);
    expect(deductsParentStock({ isBundle: false, isService: true })).toBe(false);
    expect(deductsParentStock({ isBundle: false, isService: false })).toBe(true);
  });

  it("accompanimentBomOnly excluye botellas clasificadas como licor", () => {
    const names = new Map([
      [1, "Whisky Buchanan's 18"],
      [2, "MINALBA SPARKLING SODA LATA 355 ML"],
      [3, "MEDIA BOLSA DE HIELO"],
      [4, "VASOS PLASTICOS LOS LLANOS N° 27"],
    ]);
    expect(
      accompanimentBomOnly(
        [
          { productId: 1, quantity: 1 },
          { productId: 2, quantity: 2 },
          { productId: 3, quantity: 1 },
          { productId: 4, quantity: 4 },
        ],
        names,
      ),
    ).toEqual([
      { productId: 2, quantity: 2 },
      { productId: 3, quantity: 1 },
      { productId: 4, quantity: 4 },
    ]);
  });

  it("DESCORCHE en servicio no incluye botella en BOM de stock", () => {
    const names = new Map([
      [10, "Ron Carore"],
      [11, "AGUA GLACIER 380 ML"],
    ]);
    const service = {
      isBundle: false,
      isService: true,
      bundleComponents: [
        { productId: 10, quantity: 1 },
        { productId: 11, quantity: 2 },
      ],
    };
    expect(bomLinesForStock(service, "DESCORCHE", names)).toEqual([
      { productId: 11, quantity: 2 },
    ]);
    expect(bomLinesForStock(service, "STANDARD", names)).toEqual([
      { productId: 10, quantity: 1 },
      { productId: 11, quantity: 2 },
    ]);
  });

  it("collectSaleStockNeeds: combo baja componentes; DESCORCHE no baja botella", () => {
    const names = new Map([
      [100, "Combo Buch 18"],
      [101, "Whisky Buchanan's 18"],
      [102, "MINALBA SPARKLING SODA LATA 355 ML"],
      [200, "DESCORCHE-30"],
      [201, "VASOS PLASTICOS"],
    ]);
    const products = new Map([
      [
        100,
        {
          id: 100,
          name: "Combo Buch 18",
          isBundle: true,
          isService: false,
          bundleComponents: [
            { productId: 101, quantity: 1 },
            { productId: 102, quantity: 2 },
          ],
        },
      ],
      [
        200,
        {
          id: 200,
          name: "DESCORCHE-30",
          isBundle: false,
          isService: true,
          bundleComponents: [
            { productId: 101, quantity: 1 },
            { productId: 201, quantity: 4 },
          ],
        },
      ],
      [
        50,
        {
          id: 50,
          name: "Refresco",
          isBundle: false,
          isService: false,
          bundleComponents: null,
        },
      ],
    ]);

    expect(
      collectSaleStockNeeds(
        [
          { productId: 100, quantity: 2, saleMode: "STANDARD" },
          { productId: 200, quantity: 1, saleMode: "DESCORCHE" },
          { productId: 50, quantity: 3, saleMode: "STANDARD" },
        ],
        products,
        names,
      ),
    ).toEqual([
      { productId: 101, quantity: 2 }, // solo del combo ×2; descorche no suma botella
      { productId: 102, quantity: 4 },
      { productId: 201, quantity: 4 },
      { productId: 50, quantity: 3 },
    ]);
  });

  it("mergeBomNeeds agrega necesidades de varias líneas por productId", () => {
    const merged = mergeBomNeeds([
      explodeBom(
        [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 1 },
        ],
        2,
      ),
      explodeBom([{ productId: 1, quantity: 1 }], 3),
      [{ productId: 3, quantity: 5 }],
    ]);
    expect(merged).toEqual([
      { productId: 1, quantity: 7 },
      { productId: 2, quantity: 2 },
      { productId: 3, quantity: 5 },
    ]);
  });

  it("findUnstockableBomNeed rechaza componente isService", () => {
    const byId = new Map([
      [
        1,
        { id: 1, name: "Descorche $30", isBundle: false, isService: true },
      ],
      [2, { id: 2, name: "Vaso", isBundle: false, isService: false }],
    ]);
    const bad = findUnstockableBomNeed(
      [
        { productId: 2, quantity: 4 },
        { productId: 1, quantity: 1 },
      ],
      byId,
    );
    expect(bad).toEqual({
      productId: 1,
      name: "Descorche $30",
      reason: "isService",
    });
    expect(unstockableBomNeedMessage(bad!, "el servicio")).toMatch(/servicio/);
  });

  it("findUnstockableBomNeed rechaza combo anidado", () => {
    const byId = new Map([
      [9, { id: 9, name: "Mini combo", isBundle: true, isService: false }],
    ]);
    expect(
      findUnstockableBomNeed([{ productId: 9, quantity: 1 }], byId)?.reason,
    ).toBe("isBundle");
  });

  it("findBottleInBom detecta licor en BOM de servicio (invariante descorche)", () => {
    const names = new Map([
      [10, "Whisky Buchanan's 18"],
      [11, "VASOS PLASTICOS"],
    ]);
    expect(
      findBottleInBom(
        [
          { productId: 10, quantity: 1 },
          { productId: 11, quantity: 4 },
        ],
        names,
      ),
    ).toEqual({ productId: 10, quantity: 1 });
    expect(
      findBottleInBom([{ productId: 11, quantity: 4 }], names),
    ).toBeNull();
  });

  it("oracle combo: necesidades no incluyen el padre isBundle", () => {
    const names = new Map([
      [100, "Combo Buch 18"],
      [101, "Whisky Buchanan's 18"],
      [102, "MINALBA SPARKLING SODA LATA 355 ML"],
    ]);
    const products = new Map([
      [
        100,
        {
          id: 100,
          name: "Combo Buch 18",
          isBundle: true,
          isService: false,
          bundleComponents: [
            { productId: 101, quantity: 1 },
            { productId: 102, quantity: 2 },
          ],
        },
      ],
    ]);
    const needs = collectSaleStockNeeds(
      [{ productId: 100, quantity: 1, saleMode: "STANDARD" }],
      products,
      names,
    );
    expect(needs.map((n) => n.productId)).not.toContain(100);
    expect(needs).toEqual([
      { productId: 101, quantity: 1 },
      { productId: 102, quantity: 2 },
    ]);
  });

  it("oracle descorche: send/charge/void usan las mismas necesidades (sin botella)", () => {
    const names = new Map([
      [200, "DESCORCHE-30"],
      [101, "Whisky Buchanan's 18"],
      [201, "VASOS PLASTICOS"],
    ]);
    const products = new Map([
      [
        200,
        {
          id: 200,
          name: "DESCORCHE-30",
          isBundle: false,
          isService: true,
          bundleComponents: [
            { productId: 101, quantity: 1 },
            { productId: 201, quantity: 4 },
          ],
        },
      ],
      [
        101,
        {
          id: 101,
          name: "Whisky Buchanan's 18",
          isBundle: false,
          isService: false,
          bundleComponents: null,
        },
      ],
      [
        201,
        {
          id: 201,
          name: "VASOS PLASTICOS",
          isBundle: false,
          isService: false,
          bundleComponents: null,
        },
      ],
    ]);
    const lines = [{ productId: 200, quantity: 1, saleMode: "DESCORCHE" as const }];
    const needs = collectSaleStockNeeds(lines, products, names);
    // Misma función alimenta reserva (send), descuento (charge) y restore (void/cancel)
    expect(needs).toEqual([{ productId: 201, quantity: 4 }]);
    expect(needs.map((n) => n.productId)).not.toContain(101);
    expect(needs.map((n) => n.productId)).not.toContain(200);
  });
});
