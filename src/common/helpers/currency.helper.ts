/**
 * Helpers de conversión de moneda para el servidor.
 * USD es la moneda de referencia del sistema; VES se convierte con la tasa BCV/Paralelo.
 * El IVA 16% debe calcularse sobre montos ya convertidos a BS.
 */

export type ProductCurrency = "USD" | "VES";

/** Redondeo a 2 decimales (criterios SENIAT). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Tasa válida para conversión: nunca 0 ni NaN. */
export function safeExchangeRate(rate: number): number {
  const n = Number(rate);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function normalizeProductCurrency(
  currency?: string | null,
): ProductCurrency {
  return currency === "VES" ? "VES" : "USD";
}

/**
 * Convierte monto en USD a BS usando la tasa configurada.
 * Usar antes de aplicar IVA o al registrar credit_transactions (amount_bs).
 */
export function convertUsdToBs(
  amountUsd: number,
  exchangeRate: number,
): number {
  return round2(amountUsd * safeExchangeRate(exchangeRate));
}

/**
 * Convierte monto en BS a USD usando la tasa configurada.
 */
export function convertBsToUsd(amountBs: number, exchangeRate: number): number {
  return round2(amountBs / safeExchangeRate(exchangeRate));
}

/**
 * Convierte precio/costo de catálogo a USD (referencia del sistema).
 * - USD: sin conversión.
 * - VES: divide por la tasa.
 */
export function toUsdAmount(
  amount: number,
  currency: string | null | undefined,
  exchangeRate: number,
): number {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (normalizeProductCurrency(currency) === "VES") {
    return convertBsToUsd(value, exchangeRate);
  }
  return round2(value);
}

/** Costo unitario de producto en USD (costPrice se almacena siempre en USD). */
export function productCostUsd(costPrice: number): number {
  const value = Number(costPrice);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return round2(value);
}

/** Precio de venta de producto en USD. */
export function productSaleUsd(
  salePrice: number,
  salePriceCurrency: string | null | undefined,
  exchangeRate: number,
): number {
  return toUsdAmount(salePrice, salePriceCurrency, exchangeRate);
}
