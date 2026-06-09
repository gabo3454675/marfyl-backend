/**
 * Boletería Monddy — dos precios por asiento (planilla flyer):
 * - Efectivo USD: priceUsd (ej. $60).
 * - Pago móvil / transferencia: priceBsUsd (ej. $70) × tasa BCV = monto en bolívares.
 */
export function resolveConcertExchangeRate(
  rate: number | null | undefined,
): number {
  if (rate != null && Number.isFinite(rate) && rate > 0) return rate;
  return 1;
}

/** Convierte el monto USD de la vía bolívares al monto en Bs. */
export function usdToBsForConcert(usd: number, exchangeRate: number): number {
  return Math.round(usd * exchangeRate * 100) / 100;
}

/** Monto en Bs a cobrar: tier USD bolívares × tasa BCV. */
export function concertBsPaymentAmount(
  priceBsUsd: number,
  exchangeRate: number,
): number {
  return usdToBsForConcert(priceBsUsd, exchangeRate);
}
