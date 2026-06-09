import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import type {
  DolarApiRateKind,
  DolarApiVenezuelaQuote,
} from "./dolar-api.types";

/**
 * Cliente para DolarApi Venezuela (https://ve.dolarapi.com).
 * Proyecto open source: https://github.com/enzonotario/esjs-dolar-api
 */
@Injectable()
export class DolarApiService {
  private readonly logger = new Logger(DolarApiService.name);

  private get baseUrl(): string {
    return (
      process.env.DOLAR_API_VE_BASE_URL?.trim() || "https://ve.dolarapi.com"
    );
  }

  private get rateKind(): DolarApiRateKind {
    const raw = (process.env.DOLAR_API_RATE_KIND || "oficial").toLowerCase();
    return raw === "paralelo" ? "paralelo" : "oficial";
  }

  async fetchQuote(kind?: DolarApiRateKind): Promise<DolarApiVenezuelaQuote> {
    const path = kind ?? this.rateKind;
    const url = `${this.baseUrl}/v1/dolares/${path}`;

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
        "No se pudo obtener la tasa BCV desde DolarApi. Intenta más tarde o ingresa la tasa manualmente.",
      );
    }
  }

  /** Tasa USD/VES a usar en MARFYL (promedio BCV, fallback venta/compra). */
  resolveUsdVesRate(quote: DolarApiVenezuelaQuote): number {
    const candidate = quote.promedio ?? quote.venta ?? quote.compra;
    const rate = Number(candidate);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new ServiceUnavailableException(
        "DolarApi devolvió una cotización inválida.",
      );
    }
    return Math.round(rate * 10_000) / 10_000;
  }

  getSourceLabel(quote: DolarApiVenezuelaQuote): string {
    return quote.nombre?.trim() || "BCV (DolarApi)";
  }
}
