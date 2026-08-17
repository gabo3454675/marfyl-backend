import {
  parseBomLines,
  explodeBom,
  mergeBomNeeds,
  maxBuildable,
  combosUsingComponent,
} from "./bundle-bom";

describe("bundle-bom", () => {
  it("parsea y fusiona líneas duplicadas", () => {
    expect(
      parseBomLines([
        { productId: 1, quantity: 2 },
        { productId: 1, quantity: 3 },
        { productId: 2, quantity: 1 },
        { productId: "x", quantity: 1 },
        { productId: 3, quantity: 0 },
      ]),
    ).toEqual([
      { productId: 1, quantity: 5 },
      { productId: 2, quantity: 1 },
    ]);
  });

  it("parseBomLines rechaza quantity 0.5", () => {
    expect(parseBomLines([{ productId: 1, quantity: 0.5 }])).toEqual([]);
  });

  it("explode multiplica la receta por la cantidad vendida", () => {
    expect(
      explodeBom(
        [
          { productId: 10, quantity: 12 },
          { productId: 11, quantity: 1 },
        ],
        2,
      ),
    ).toEqual([
      { productId: 10, quantity: 24 },
      { productId: 11, quantity: 2 },
    ]);
  });

  it("explodeBom con n=0 retorna vacío", () => {
    expect(
      explodeBom([{ productId: 10, quantity: 12 }], 0),
    ).toEqual([]);
  });

  it("explodeBom con comboQty fraccionario hace floor", () => {
    expect(
      explodeBom([{ productId: 10, quantity: 3 }], 2.9),
    ).toEqual([{ productId: 10, quantity: 6 }]);
  });

  it("mergeBomNeeds suma por productId entre listas", () => {
    expect(
      mergeBomNeeds([
        [
          { productId: 1, quantity: 2 },
          { productId: 2, quantity: 1 },
        ],
        [
          { productId: 1, quantity: 3 },
          { productId: 3, quantity: 4 },
        ],
        [],
      ]),
    ).toEqual([
      { productId: 1, quantity: 5 },
      { productId: 2, quantity: 1 },
      { productId: 3, quantity: 4 },
    ]);
  });

  it("maxBuildable usa el cuello de botella", () => {
    const stock = new Map([
      [10, 25],
      [11, 3],
    ]);
    expect(
      maxBuildable(
        [
          { productId: 10, quantity: 12 },
          { productId: 11, quantity: 1 },
        ],
        stock,
      ),
    ).toEqual({ max: 2, bottleneckProductId: 10 });
  });

  it("maxBuildable con lines vacías retorna max 0", () => {
    expect(maxBuildable([], new Map([[1, 10]]))).toEqual({
      max: 0,
      bottleneckProductId: null,
    });
  });

  it("combosUsingComponent es el índice inverso", () => {
    const combos = [
      { id: 1, lines: [{ productId: 10, quantity: 12 }] },
      { id: 2, lines: [{ productId: 11, quantity: 1 }] },
      { id: 3, lines: [{ productId: 10, quantity: 6 }] },
    ];
    expect(combosUsingComponent(combos, 10)).toEqual([1, 3]);
  });
});
