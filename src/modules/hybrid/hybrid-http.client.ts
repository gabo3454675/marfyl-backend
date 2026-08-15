import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  buildHybridAuthHeaders,
  getHybridApiBaseUrl,
  getHybridApiTimeoutMs,
  getHybridApiToken,
} from "./hybrid.config";

export type HybridHttpResult = {
  status: number;
  body: unknown;
};

/**
 * Cliente HTTP de solo lectura hacia Hybrid.
 * Nunca acepta method distinto de GET; no reenvía headers del cliente.
 */
@Injectable()
export class HybridHttpClient {
  private readonly logger = new Logger(HybridHttpClient.name);

  async get(
    path: string,
    query?: Record<string, string>,
  ): Promise<HybridHttpResult> {
    return this.requestGet(path, query);
  }

  private async requestGet(
    path: string,
    query?: Record<string, string>,
  ): Promise<HybridHttpResult> {
    const base = getHybridApiBaseUrl().replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${base}${normalizedPath}`);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const token = getHybridApiToken();
    const timeoutMs = getHybridApiTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: buildHybridAuthHeaders(token),
        signal: controller.signal,
      });

      const body = await this.parseBody(res);
      return { status: res.status, body };
    } catch (e: unknown) {
      throw this.toUpstreamError(e, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => "");
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text.slice(0, 500) };
    }
  }

  private toUpstreamError(e: unknown, timeoutMs: number): Error {
    if (e instanceof BadGatewayException || e instanceof GatewayTimeoutException) {
      return e;
    }

    const isAbort =
      (e instanceof Error && e.name === "AbortError") ||
      (typeof e === "object" &&
        e !== null &&
        "name" in e &&
        (e as { name: string }).name === "AbortError");

    if (isAbort) {
      this.logger.warn(
        `Hybrid timeout tras ~${Math.round(timeoutMs / 1000)}s`,
      );
      return new GatewayTimeoutException(
        "Hybrid no respondió a tiempo. Intenta de nuevo más tarde.",
      );
    }

    const message = e instanceof Error ? e.message : "error de red";
    // Nunca incluir token ni URL con credenciales en el mensaje al cliente.
    this.logger.error(`Hybrid red/upstream: ${message}`);
    return new BadGatewayException(
      "No se pudo contactar el servicio Hybrid. Intenta de nuevo más tarde.",
    );
  }
}
