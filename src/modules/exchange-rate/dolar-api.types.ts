/** Respuesta de https://ve.dolarapi.com (proyecto esjs-dolar-api / DolarApi.com) */
export interface DolarApiVenezuelaQuote {
  fuente: string;
  nombre: string;
  compra: number | null;
  venta: number | null;
  promedio: number | null;
  fechaActualizacion: string;
}

export type DolarApiRateKind = "oficial" | "paralelo";
export type DolarApiCurrency = "USD" | "EUR";

export interface DolarApiRateStrategy {
  readonly currency: DolarApiCurrency;
  readonly endpoint: string;
  readonly displayName: string;
  resolveRate(quote: DolarApiVenezuelaQuote): number;
  getSourceLabel(quote: DolarApiVenezuelaQuote): string;
}
