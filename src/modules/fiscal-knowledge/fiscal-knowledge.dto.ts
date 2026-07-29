import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

/**
 * Query params para `GET /api/fiscal-knowledge/search`.
 *
 * Validados por el `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`,
 * `transform` con conversión implícita). El agente Python envía `q` y `limit`
 * como query string; el backend los sanea antes de tocar el servicio.
 *
 * Nota: el servicio interno clamp `limit` a un máximo de 10 resultados
 * (ver `FiscalKnowledgeService.searchSemantic`). El controller acepta hasta
 * 50 por contrato, pero el número efectivo de hits puede ser menor.
 */
export class FiscalKnowledgeSearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  q!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/**
 * Hit estable devuelto al agente. No expone `chunkIndex` ni `metadata`
 * (detalles internos de chunking/embedding) para mantener un contrato
 * versionable. Si el agente necesita más campos, se añaden aquí de forma
 * explícita y documentada.
 */
export interface FiscalKnowledgeSearchHitDto {
  ley: string;
  leyLabel: string;
  articulo: number;
  titulo: string | null;
  content: string;
  similarity: number;
  rerankScore: number;
}

export interface FiscalKnowledgeSearchResponseDto {
  hits: FiscalKnowledgeSearchHitDto[];
  confident: boolean;
}
