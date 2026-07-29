import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateOrReject } from "class-validator";
import { Role } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import {
  CatalogResponse,
  FISCAL_QUERY_DEFAULTS,
  FiscalCatalogEntry,
} from "./catalog/fiscal-catalog.types";
import {
  getCatalogEntriesResponse,
  getCatalogVersion,
  getFiscalCatalogEntry,
} from "./catalog/fiscal-catalog";
import { FiscalQueryDto } from "./fiscal-query.dto";
import {
  FiscalAuditLogger,
  FiscalAuditRecord,
  computeParamsHash,
} from "./audit/fiscal-audit.logger";

export interface FiscalQueryResult {
  query: string;
  rows: unknown[];
  page: number;
  pageSize: number;
  truncated: boolean;
  rowCount: number;
}

export interface FiscalQueryRequestContext {
  organizationId: number;
  userId: number;
  /** Rol real del miembro (propagado por OrganizationGuard, B2). */
  role: Role;
  /** correlation_id para trazabilidad (header o generado). */
  correlationId: string;
}

/**
 * Servicio de ejecución de queries fiscales parametrizadas.
 *
 * Flujo:
 * 1. Validar que `query` exista en el catálogo (allow-list).
 * 2. Validar RBAC: el rol real del miembro debe estar en `entry.roles`.
 * 3. Validar `params` contra el DTO declarado en la entrada (class-validator).
 * 4. Aplicar límites C1 (pageSize ≤ 100, row cap 1000, timeout 5s, 1 query).
 * 5. Ejecutar vía Prisma parametrizada (NUNCA $queryRawUnsafe).
 * 6. Si row cap excedido → `truncated: true` (no error) (C6).
 * 7. Registrar auditoría con 11 campos (C4), sin params en claro.
 */
@Injectable()
export class FiscalQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogger: FiscalAuditLogger,
  ) {}

  /**
   * Construye la respuesta saneada del catálogo (C5): versión + entradas con
   * metadata de contrato (id, description, paramsSchema, roles). No expone
   * SQL, tablas, ni `run`/`paramsClass`.
   */
  getCatalogResponse(): CatalogResponse {
    return {
      catalogVersion: getCatalogVersion(),
      entries: getCatalogEntriesResponse(),
    };
  }

  async execute(
    dto: FiscalQueryDto,
    ctx: FiscalQueryRequestContext,
  ): Promise<FiscalQueryResult> {
    const startedAt = Date.now();
    const entry = this.resolveEntry(dto.query);
    this.assertRoleAllowed(entry, ctx.role);
    const params = await this.validateParams(entry, dto.params);
    this.validateCrossField(entry, params);

    const pageSize = this.resolvePageSize(dto.pageSize);
    const page = dto.page ?? 1;
    const rowCap = FISCAL_QUERY_DEFAULTS.ROW_CAP;

    const rows = await this.runWithTimeout(entry, {
      prisma: this.prisma,
      organizationId: ctx.organizationId,
      params,
      rowCap,
    });

    const rowCount = rows.length;
    const truncated = rowCount >= rowCap;
    const paged = this.paginate(rows, page, pageSize);

    const durationMs = Date.now() - startedAt;
    this.recordAudit({
      ctx,
      entry,
      params,
      rowCount,
      truncated,
      durationMs,
      status: "OK",
    });

    return {
      query: entry.id,
      rows: paged,
      page,
      pageSize,
      truncated,
      rowCount,
    };
  }

  private resolveEntry(queryId: string): FiscalCatalogEntry {
    const entry = getFiscalCatalogEntry(queryId);
    if (!entry) {
      throw new BadRequestException(
        `Query '${queryId}' no está en el catálogo allow-list`,
      );
    }
    return entry;
  }

  private assertRoleAllowed(entry: FiscalCatalogEntry, role: Role): void {
    if (!entry.roles.includes(role)) {
      throw new ForbiddenException(
        `El rol '${role}' no está autorizado para la query '${entry.id}'`,
      );
    }
  }

  private async validateParams(
    entry: FiscalCatalogEntry,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const instance = plainToInstance(
      entry.paramsClass as new () => Record<string, unknown>,
      raw ?? {},
    );
    try {
      await validateOrReject(instance as object);
    } catch (err) {
      const message = formatValidationError(err);
      throw new BadRequestException(
        `Params inválidos para '${entry.id}': ${message}`,
      );
    }
    return instance as Record<string, unknown>;
  }

  private validateCrossField(
    entry: FiscalCatalogEntry,
    params: Record<string, unknown>,
  ): void {
    if (entry.id === "withholding_summary_by_supplier") {
      const from = new Date(params.fromDate as string).getTime();
      const to = new Date(params.toDate as string).getTime();
      if (!(Number.isFinite(from) && Number.isFinite(to) && from <= to)) {
        throw new BadRequestException(
          "fromDate debe ser anterior o igual a toDate",
        );
      }
    }
  }

  private resolvePageSize(pageSize: number | undefined): number {
    if (pageSize == null) return FISCAL_QUERY_DEFAULTS.DEFAULT_PAGE_SIZE;
    return Math.min(pageSize, FISCAL_QUERY_DEFAULTS.MAX_PAGE_SIZE);
  }

  private paginate(rows: unknown[], page: number, pageSize: number): unknown[] {
    const start = (page - 1) * pageSize;
    if (start < 0 || start >= rows.length) return [];
    return rows.slice(start, start + pageSize);
  }

  private async runWithTimeout(
    entry: FiscalCatalogEntry,
    runnerCtx: {
      prisma: PrismaService;
      organizationId: number;
      params: Record<string, unknown>;
      rowCap: number;
    },
  ): Promise<unknown[]> {
    const timeoutMs = FISCAL_QUERY_DEFAULTS.TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Query timeout after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      const result = await Promise.race([
        entry.run(runnerCtx as never),
        timeout,
      ]);
      return Array.isArray(result) ? result : [];
    } catch (err) {
      throw new BadRequestException(
        `Error ejecutando query '${entry.id}': ${(err as Error).message}`,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private recordAudit(args: {
    ctx: FiscalQueryRequestContext;
    entry: FiscalCatalogEntry;
    params: Record<string, unknown>;
    rowCount: number;
    truncated: boolean;
    durationMs: number;
    status: FiscalAuditRecord["status"];
  }): void {
    const record: FiscalAuditRecord = {
      correlation_id: args.ctx.correlationId,
      timestamp: new Date().toISOString(),
      user_id: args.ctx.userId,
      organization_id: args.ctx.organizationId,
      catalog_query_id: args.entry.id,
      params_hash: computeParamsHash(args.params),
      roles_granted: [args.ctx.role],
      row_count: args.rowCount,
      truncated: args.truncated,
      duration_ms: args.durationMs,
      status: args.status,
    };
    this.auditLogger.log(record);
  }
}

function formatValidationError(err: unknown): string {
  if (!Array.isArray(err)) return (err as Error)?.message ?? "validation error";
  return err
    .map((e: { property?: string; constraints?: Record<string, string> }) => {
      const c = e.constraints ? Object.values(e.constraints).join(", ") : "";
      return `${e.property ?? "param"}: ${c}`;
    })
    .join("; ");
}
