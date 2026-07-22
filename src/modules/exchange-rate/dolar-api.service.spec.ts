import { ServiceUnavailableException } from "@nestjs/common";
import { DolarApiService } from "./dolar-api.service";
import type { DolarApiVenezuelaQuote } from "./dolar-api.types";

const quote: DolarApiVenezuelaQuote = {
  fuente: "BCV",
  nombre: "Oficial",
  compra: 100,
  venta: 101,
  promedio: 100.5,
  fechaActualizacion: "2026-07-22T12:00:00.000Z",
};

describe("DolarApiService strategies", () => {
  const service = new DolarApiService();

  it("resuelve USD y EUR con endpoints independientes", () => {
    expect(service.getStrategy("USD").endpoint).toBe("/v1/dolares/oficial");
    expect(service.getStrategy("EUR").endpoint).toBe("/v1/euros/oficial");
    expect(service.resolveRate("USD", quote)).toBe(100.5);
    expect(service.resolveRate("EUR", quote)).toBe(100.5);
  });

  it("rechaza cotizaciones inválidas para ambas estrategias", () => {
    const invalidQuote = { ...quote, promedio: null, compra: null, venta: null };

    expect(() => service.resolveRate("USD", invalidQuote)).toThrow(
      ServiceUnavailableException,
    );
    expect(() => service.resolveRate("EUR", invalidQuote)).toThrow(
      ServiceUnavailableException,
    );
  });
});
