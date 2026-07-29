import { Role } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * Límites operativos del endpoint fiscal/query (criterios C1).
 * Aplicados por el servicio antes y después de ejecutar la query.
 */
export interface FiscalQueryLimits {
  /** Tamaño de página máximo permitido (default 50, cap 100). */
  maxPageSize: number;
  /** Tope duro de filas devueltas por request (cap 1000). */
  rowCap: number;
  /** Timeout de ejecución en ms (5s). */
  timeoutMs: number;
}

export const FISCAL_QUERY_DEFAULTS = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 100,
  ROW_CAP: 1000,
  TIMEOUT_MS: 5_000,
} as const;

/**
 * Contexto que recibe el runner de una entrada del catálogo.
 * `params` ya está validado contra el DTO declarado en la entrada; el runner
 * lo trata como `Record<string, unknown>` y hace el cast interno al tipo
 * concreto (la validación de class-validator garantiza la forma).
 */
export interface FiscalQueryRunnerContext {
  prisma: PrismaService;
  organizationId: number;
  params: Record<string, unknown>;
  /** Tope de filas que el runner debe respetar (rowCap). */
  rowCap: number;
}

/**
 * Entrada del catálogo allow-list de queries fiscales.
 *
 * El catálogo es código versionado (no configurable en runtime) para reducir
 * el riesgo de inyección: solo las queries aquí declaradas pueden ejecutarse.
 *
 * `paramsClass` es una clase de class-validator usada para instanciar y
 * validar `params` antes de invocar el runner. El catálogo es una colección
 * heterogénea, por eso `params`/`run` operan con `Record<string, unknown>`
 * y cada runner hace el cast al tipo concreto.
 */
export interface FiscalCatalogEntry {
  /** catalog_query_id — valor que el cliente envía en `query`. */
  id: string;
  /** Descripción humana del propósito de la query. */
  description: string;
  /** Roles permitidos para esta entrada (RBAC por entrada). */
  roles: Role[];
  /** Clase DTO (class-validator) para validar `params`. */
  paramsClass: new () => Record<string, unknown>;
  /**
   * Ejecuta la query vía Prisma parametrizada (findMany / groupBy / $queryRaw
   * tagged templates). NUNCA $queryRawUnsafe. Debe respetar `rowCap`.
   */
  run: (ctx: FiscalQueryRunnerContext) => Promise<unknown[]>;
}

/**
 * Campo del schema de params expuesto en el catálogo público (saneado).
 * NO incluye SQL, nombres de tablas ni campos internos — solo metadata de
 * contrato para que el agente sepa qué enviar.
 */
export interface CatalogEntryParamsField {
  name: string;
  /** Tipo simple derivado de los decoradores class-validator. */
  type: "integer" | "number" | "string" | "date" | "boolean" | "unknown";
  required: boolean;
}

/**
 * Entrada saneada del catálogo expuesta vía `GET /api/fiscal/query/catalog`.
 * No expone `run` ni `paramsClass` ( internals), solo contrato.
 */
export interface CatalogEntryResponse {
  id: string;
  description: string;
  paramsSchema: CatalogEntryParamsField[];
  roles: Role[];
}

/**
 * Respuesta del endpoint `GET /api/fiscal/query/catalog` (C5).
 * `catalogVersion` permite al agente detectar drift entre su versión
 * esperada y la del backend.
 */
export interface CatalogResponse {
  catalogVersion: string;
  entries: CatalogEntryResponse[];
}
