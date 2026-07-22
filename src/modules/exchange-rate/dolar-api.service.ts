import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type {
  DolarApiCurrency,
  DolarApiRateKind,
  DolarApiRateStrategy,
  DolarApiVenezuelaQuote,
} from "./dolar-api.types";

function resolvePositiveRate(
  quote: DolarApiVenezuelaQuote,
  displayName: string,
): number {
  const candidate = quote.promedio ?? quote.venta ?? quote.compra;
  const rate = Number(candidate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new ServiceUnavailableException(
      `DolarApi devolvió una cotización ${displayName} inválida.`,
    );
  }
  return Math.round(rate * 10_000) / 10_000;
}

function sourceLabel(
  quote: DolarApiVenezuelaQuote,
  currency: DolarApiCurrency,
): string {
  const name = quote.nombre?.trim();
  if (name) return `BCV ${currency} (${name})`;
  return `BCV ${currency} (DolarApi)`;
}

const USD_BCV_STRATEGY: DolarApiRateStrategy = {
  currency: "USD",
  endpoint: "/v1/dolares/oficial",
  displayName: "Dólar BCV",
  resolveRate: (quote) => resolvePositiveRate(quote, "Dólar BCV"),
  getSourceLabel: (quote) => sourceLabel(quote, "USD"),
};

const EUR_BCV_STRATEGY: DolarApiRateStrategy = {
  currency: "EUR",
  endpoint: "/v1/euros/oficial",
  displayName: "Euro BCV",
  resolveRate: (quote) => resolvePositiveRate(quote, "Euro BCV"),
  getSourceLabel: (quote) => sourceLabel(quote, "EUR"),
};

/**
 * Cliente para DolarApi Venezuela (https://ve.dolarapi.com).
 * Proyecto open source: https://github.com/enzonotario/esjs-dolar-api
 *
 * Cada moneda usa una estrategia con endpoint, validación y fuente propios.
 */
@Injectable()
export class DolarApiService {
  private readonly logger = new Logger(DolarApiService.name);
  private readonly strategies: Record<DolarApiCurrency, DolarApiRateStrategy> = {
    USD: USD_BCV_STRATEGY,
    EUR: EUR_BCV_STRATEGY,
  };

  private get baseUrl(): string {
    return (
      process.env.DOLAR_API_VE_BASE_URL?.trim() || "https://ve.dolarapi.com"
    );
  }

  private get rateKind(): DolarApiRateKind {
    const raw = (process.env.DOLAR_API_RATE_KIND || "oficial").toLowerCase();
    return raw === "paralelo" ? "paralelo" : "oficial";
  }

  getStrategy(currency: DolarApiCurrency): DolarApiRateStrategy {
    return this.strategies[currency];
  }

  async fetchQuote(
    currency: DolarApiCurrency = "USD",
    kind?: DolarApiRateKind,
  ): Promise<DolarApiVenezuelaQuote> {
    const strategy = this.getStrategy(currency);
    const endpoint =
      currency === "USD"
        ? `/v1/dolares/${kind ?? this.rateKind}`
        : strategy.endpoint;
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(
          Number(process.env.DOLAR_API_TIMEOUT_MS ?? 15_000),
        ),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as DolarApiVenezuelaQuote;
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`DolarApi falló (${url}): ${message}`);
      throw new ServiceUnavailableException(
        `No se pudo obtener la tasa ${strategy.displayName} desde DolarApi. Intenta más tarde.`,
      );
    }
  }

  resolveRate(
    currency: DolarApiCurrency,
    quote: DolarApiVenezuelaQuote,
  ): number {
    return this.getStrategy(currency).resolveRate(quote);
  }

  getSourceLabel(
    currency: DolarApiCurrency,
    quote: DolarApiVenezuelaQuote,
  ): string {
    return this.getStrategy(currency).getSourceLabel(quote);
  }
}
