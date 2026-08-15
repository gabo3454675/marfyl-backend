import { projectStock } from "./stock-projection.util";

describe("projectStock", () => {
  it("matched + affectsStock: salida (out) resta stock", () => {
    expect(
      projectStock({
        direction: "out",
        quantity: 3,
        currentStock: 10,
        affectsStock: true,
        matched: true,
      }),
    ).toEqual({
      currentStock: 10,
      stockDelta: -3,
      finalStock: 7,
    });
  });

  it("matched + affectsStock: entrada (in) suma stock", () => {
    expect(
      projectStock({
        direction: "in",
        quantity: 5,
        currentStock: 2,
        affectsStock: true,
        matched: true,
      }),
    ).toEqual({
      currentStock: 2,
      stockDelta: 5,
      finalStock: 7,
    });
  });

  it("matched + affectsStock: currentStock null se trata como 0", () => {
    expect(
      projectStock({
        direction: "out",
        quantity: 4,
        currentStock: null,
        affectsStock: true,
        matched: true,
      }),
    ).toEqual({
      currentStock: 0,
      stockDelta: -4,
      finalStock: -4,
    });
  });

  it("matched + servicio/combo (affectsStock false): delta 0, sin impacto", () => {
    expect(
      projectStock({
        direction: "out",
        quantity: 3,
        currentStock: 10,
        affectsStock: false,
        matched: true,
      }),
    ).toEqual({
      currentStock: 10,
      stockDelta: 0,
      finalStock: 10,
    });
  });

  it("sin match (matched false): null en los tres campos", () => {
    expect(
      projectStock({
        direction: "out",
        quantity: 3,
        currentStock: null,
        affectsStock: true,
        matched: false,
      }),
    ).toEqual({
      currentStock: null,
      stockDelta: null,
      finalStock: null,
    });
  });

  it("sin match (matched false): null aunque affectsStock sea false", () => {
    expect(
      projectStock({
        direction: "in",
        quantity: 3,
        currentStock: 10,
        affectsStock: false,
        matched: false,
      }),
    ).toEqual({
      currentStock: null,
      stockDelta: null,
      finalStock: null,
    });
  });
});
