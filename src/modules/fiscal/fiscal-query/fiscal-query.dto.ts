import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { FISCAL_QUERY_DEFAULTS } from "./catalog/fiscal-catalog.types";

/**
 * Body de `POST /api/fiscal/query`.
 *
 * - `query`: catalog_query_id (debe existir en la allow-list).
 * - `params`: objeto con los parámetros de la query; validados contra el
 *   DTO declarado en la entrada del catálogo.
 * - `page` / `pageSize`: paginación opcional (pageSize ≤ 100, default 50).
 */
export class FiscalQueryDto {
  @IsString()
  @IsNotEmpty()
  query!: string;

  @IsObject()
  @IsNotEmpty()
  params!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(FISCAL_QUERY_DEFAULTS.MAX_PAGE_SIZE)
  pageSize?: number;
}
