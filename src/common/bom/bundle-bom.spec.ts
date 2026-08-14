import {
  parseBomLines,
  explodeBom,
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

  it("combosUsingComponent es el índice inverso", () => {
    const combos = [
      { id: 1, lines: [{ productId: 10, quantity: 12 }] },
      { id: 2, lines: [{ productId: 11, quantity: 1 }] },
      { id: 3, lines: [{ productId: 10, quantity: 6 }] },
    ];
    expect(combosUsingComponent(combos, 10)).toEqual([1, 3]);
  });
});
