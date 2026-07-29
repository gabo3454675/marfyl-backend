import { Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { Role } from "@prisma/client";

/**
 * Campos de auditoría del endpoint fiscal/query (criterio C4).
 * `paramsHash` es SHA-256 de params normalizados (canonical JSON) — NUNCA
 * se loguean los valores de params en claro.
 */
export interface FiscalAuditRecord {
  correlation_id: string;
  timestamp: string;
  user_id: number;
  organization_id: number;
  catalog_query_id: string;
  params_hash: string;
  roles_granted: Role[];
  row_count: number;
  truncated: boolean;
  duration_ms: number;
  status: "OK" | "ERROR";
}

/**
 * Calcula SHA-256 sobre la representación canónica de `params`
 * (claves ordenadas recursivamente, sin valores en claro en logs).
 */
export function computeParamsHash(params: unknown): string {
  const canonical = stableCanonicalize(params);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function stableCanonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableCanonicalize).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableCanonicalize(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * Logger de auditoría fiscal. Usa el Logger de NestJS (structlog-friendly:
 * emite un JSON de una línea con los 11 campos). Inyectable y mockeable en tests.
 */
export class FiscalAuditLogger {
  private readonly logger = new Logger("FiscalAudit");

  log(record: FiscalAuditRecord): void {
    // Emisión como JSON de una línea para parseo en pipelines de logs.
    this.logger.log(JSON.stringify(record));
  }
}
