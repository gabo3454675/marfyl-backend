import {
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { HYBRID_ORG_SLUG } from "@/common/founding-orgs";
import { HybridHttpClient } from "./hybrid-http.client";
import {
  getHybridApiBaseUrlHost,
  getHybridDetailTimeoutMs,
  isConfigured,
} from "./hybrid.config";
import {
  HYBRID_EXISTENCIA_QUERY_KEYS,
  HYBRID_LIST_QUERY_KEYS,
  HYBRID_VENTA_DETAIL_QUERY_KEYS,
  HYBRID_VENTAS_QUERY_KEYS,
  pickAllowlistedQuery,
  type HybridQueryInput,
} from "./hybrid-query.allowlist";

export type HybridConnectionHealth = {
  ok: boolean;
  tablas?: number;
  solo_lectura?: boolean;
};

export type HybridConnectionStatus = {
  configured: boolean;
  baseUrlHost: string | null;
  latencyMs: number | null;
  reachable: boolean;
  health: HybridConnectionHealth | null;
  error?: string;
  checkedAt: string;
};

/**
 * Orquestación del proxy Hybrid.
 * Gate order obligatorio en cada request:
 * 1. Auth (guards en controller)
 * 2. Org slug === HYBRID_ORG_SLUG → sino NotFoundException
 * 3. isConfigured() → sino ServiceUnavailableException 503
 * 4. HybridHttpClient GET
 */
@Injectable()
export class HybridService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly http: HybridHttpClient,
  ) {}

  async getHealth(organizationId: number): Promise<unknown> {
    return this.proxyGet(organizationId, "/health");
  }

  /**
   * Diagnóstico de conexión Hybrid POS para Super Admin.
   * Sin gate Monddy (credenciales env globales). Nunca incluye el token.
   */
  async getConnectionStatus(): Promise<HybridConnectionStatus> {
    const checkedAt = new Date().toISOString();
    const baseUrlHost = getHybridApiBaseUrlHost();

    if (!isConfigured()) {
      return {
        configured: false,
        baseUrlHost,
        latencyMs: null,
        reachable: false,
        health: null,
        error:
          "Hybrid API no configurada. Defina HYBRID_API_BASE_URL y HYBRID_API_TOKEN.",
        checkedAt,
      };
    }

    const started = Date.now();
    try {
      const result = await this.http.get("/health");
      const latencyMs = Date.now() - started;

      if (result.status >= 400) {
        return {
          configured: true,
          baseUrlHost,
          latencyMs,
          reachable: false,
          health: null,
          error: `Hybrid respondió HTTP ${result.status}`,
          checkedAt,
        };
      }

      const body =
        result.body && typeof result.body === "object"
          ? (result.body as Record<string, unknown>)
          : {};
      const tablasRaw = body.tablas;
      const tablas =
        typeof tablasRaw === "number" && Number.isFinite(tablasRaw)
          ? tablasRaw
          : undefined;
      const soloLectura =
        typeof body.solo_lectura === "boolean"
          ? body.solo_lectura
          : undefined;

      return {
        configured: true,
        baseUrlHost,
        latencyMs,
        reachable: true,
        health: {
          ok: body.ok === true,
          ...(tablas !== undefined ? { tablas } : {}),
          ...(soloLectura !== undefined ? { solo_lectura: soloLectura } : {}),
        },
        checkedAt,
      };
    } catch (e: unknown) {
      const latencyMs = Date.now() - started;
      const message =
        e instanceof Error
          ? e.message
          : "No se pudo contactar el servicio Hybrid";
      return {
        configured: true,
        baseUrlHost,
        latencyMs,
        reachable: false,
        health: null,
        error: message,
        checkedAt,
      };
    }
  }

  async getCatalogos(organizationId: number): Promise<unknown> {
    return this.proxyGet(organizationId, "/catalogos");
  }

  async getCatalogoByGrupo(
    organizationId: number,
    grupo: string,
  ): Promise<unknown> {
    const encoded = encodeURIComponent(grupo);
    return this.proxyGet(organizationId, `/catalogos/${encoded}`);
  }

  async getMonedas(organizationId: number): Promise<unknown> {
    return this.proxyGet(organizationId, "/monedas");
  }

  async getInventario(
    organizationId: number,
    query?: HybridQueryInput,
  ): Promise<unknown> {
    return this.proxyGet(
      organizationId,
      "/inventario",
      pickAllowlistedQuery(query, HYBRID_LIST_QUERY_KEYS),
    );
  }

  async getInventarioByCodigo(
    organizationId: number,
    codigo: string,
  ): Promise<unknown> {
    const encoded = encodeURIComponent(codigo);
    return this.proxyGet(organizationId, `/inventario/${encoded}`);
  }

  async getClientes(
    organizationId: number,
    query?: HybridQueryInput,
  ): Promise<unknown> {
    return this.proxyGet(
      organizationId,
      "/clientes",
      pickAllowlistedQuery(query, HYBRID_LIST_QUERY_KEYS),
    );
  }

  async getExistencia(
    organizationId: number,
    query?: HybridQueryInput,
  ): Promise<unknown> {
    return this.proxyGet(
      organizationId,
      "/existencia",
      pickAllowlistedQuery(query, HYBRID_EXISTENCIA_QUERY_KEYS),
    );
  }

  async getVentas(
    organizationId: number,
    query?: HybridQueryInput,
  ): Promise<unknown> {
    return this.proxyGet(
      organizationId,
      "/ventas",
      pickAllowlistedQuery(query, HYBRID_VENTAS_QUERY_KEYS),
    );
  }

  async getVentaByDocumento(
    organizationId: number,
    documento: string,
    query?: HybridQueryInput,
  ): Promise<unknown> {
    const encoded = encodeURIComponent(documento);
    return this.proxyGet(
      organizationId,
      `/ventas/${encoded}`,
      pickAllowlistedQuery(query, HYBRID_VENTA_DETAIL_QUERY_KEYS),
      { timeoutMs: getHybridDetailTimeoutMs() },
    );
  }

  /**
   * Pipeline de gates + GET. Usado por todos los endpoints.
   * Orden fijo: org → config → client.
   */
  async proxyGet(
    organizationId: number,
    path: string,
    query?: Record<string, string>,
    options?: { timeoutMs?: number },
  ): Promise<unknown> {
    await this.assertHybridOrg(organizationId);

    if (!isConfigured()) {
      throw new ServiceUnavailableException(
        "Hybrid API no configurada. Defina HYBRID_API_BASE_URL y HYBRID_API_TOKEN.",
      );
    }

    const result =
      options !== undefined
        ? await this.http.get(path, query, options)
        : await this.http.get(path, query);

    if (result.status >= 400) {
      throw new HttpException(
        result.body ?? { statusCode: result.status, message: "Hybrid error" },
        result.status,
      );
    }

    return result.body;
  }

  private async assertHybridOrg(organizationId: number): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true },
    });

    if (!org) {
      throw new NotFoundException("Organización no encontrada");
    }

    if (org.slug !== HYBRID_ORG_SLUG) {
      throw new NotFoundException(
        "Módulo Hybrid no disponible para esta organización",
      );
    }
  }
}
