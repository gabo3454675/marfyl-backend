/**
 * Helpers de conversión de moneda para el servidor.
 * Usar la tasa configurada (BCV/Paralelo) para convertir USD ↔ BS.
 * El IVA 16% debe calcularse sobre montos ya convertidos a BS.
 */

/** Redondeo a 2 decimales (criterios SENIAT). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Convierte monto en USD a BS usando la tasa configurada.
 * Usar antes de aplicar IVA o al registrar credit_transactions (amount_bs).
 */
export function convertUsdToBs(amountUsd: number, exchangeRate: number): number {
  return round2(amountUsd * exchangeRate);
}

/**
 * Convierte monto en BS a USD usando la tasa configurada.
 */
export function convertBsToUsd(amountBs: number, exchangeRate: number): number {
  return round2(amountBs / exchangeRate);
}
