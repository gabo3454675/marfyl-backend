import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";

/**
 * Query params para GET /tenants.
 * Paginación estándar: `page` (1-based) y `limit` (1..100, default 20).
 * El ValidationPipe global tiene `transform: true` + `enableImplicitConversion: true`,
 * por lo que `@Type(() => Number)` + `@IsInt` garantiza coerción segura de query strings.
 */
export class ListTenantsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
