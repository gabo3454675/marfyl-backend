/** Tasa de la organización (Monddy) para convertir USD → Bs en boletería. */
export function resolveConcertExchangeRate(
  rate: number | null | undefined,
): number {
  if (rate != null && Number.isFinite(rate) && rate > 0) return rate;
  return 1;
}

export function usdToBsForConcert(usd: number, exchangeRate: number): number {
  return Math.round(usd * exchangeRate * 100) / 100;
}
