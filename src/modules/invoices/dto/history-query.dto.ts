import { IsDateString, IsOptional, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Parámetros de consulta para GET /invoices/history.
 * Filtra por rango de fechas y, si es superadmin, opcionalmente por organización (companyId/organizationId).
 */
export class InvoiceHistoryQueryDto {
  @IsDateString(
    {},
    { message: 'startDate debe ser una fecha válida (ISO 8601)' },
  )
  startDate: string;

  @IsDateString(
    {},
    { message: 'endDate debe ser una fecha válida (ISO 8601)' },
  )
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
