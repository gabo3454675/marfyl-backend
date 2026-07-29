import { IsOptional, IsInt, Min, IsString } from "class-validator";
import { Type } from "class-transformer";
import { IsFlexibleDate } from "@/common/validators/flexible-date.validator";

/**
 * Parámetros de consulta para GET /invoices/history.
 * Filtra por rango de fechas y, si es superadmin, opcionalmente por organización (companyId/organizationId).
 * Fechas: DD/MM/YYYY, YYYY-MM-DD o ISO 8601.
 * Compat: el FE debe preferir YYYY-MM-DD en query (funciona con @IsDateString legacy y @IsFlexibleDate).
 */
export class InvoiceHistoryQueryDto {
  @IsString()
  @IsFlexibleDate({
    message:
      "startDate debe ser una fecha válida (DD/MM/YYYY, YYYY-MM-DD o ISO 8601)",
  })
  startDate: string;

  @IsString()
  @IsFlexibleDate({
    message:
      "endDate debe ser una fecha válida (DD/MM/YYYY, YYYY-MM-DD o ISO 8601)",
  })
  endDate: string;

  /** ID de la organización a consultar. Solo superadmin puede indicar una org distinta a la activa. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  companyId?: number;

  /** Alias de companyId para consistencia con el resto del API (organizationId). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  organizationId?: number;
}
