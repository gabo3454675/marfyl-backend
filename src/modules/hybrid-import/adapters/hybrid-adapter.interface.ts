import type { ImportContext } from '../types/import-context';

/**
 * Resultado de validación estructurado.
 * CRÍTICO: validate() NO debe lanzar excepciones en batch processing.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Adapter base para transformación Hybrid → Marfyl.
 *
 * Principios:
 * - transform() es puro: no accede a DB ni a servicios externos
 * - validate() retorna resultado estructurado (nunca throw)
 * - getDedupKey() es determinístico y estable
 */
export interface HybridAdapter<TInput, TOutput> {
  /**
   * Transforma datos Hybrid a DTO de creación Marfyl.
   * PURA: sin side effects, sin DB access.
   */
  transform(input: TInput, context: ImportContext): TOutput;

  /**
   * Genera clave de deduplicación determinística.
   * DEBE ser estable: mismo input → misma key siempre.
   */
  getDedupKey(input: TInput): string;

  /**
   * Valida input sin lanzar excepciones.
   * Retorna resultado estructurado para procesamiento batch.
   * `options.skipLinesCheck` permite omitir la validación de líneas
   * cuando el input proviene de un listado (sin detalle cargado).
   */
  validate(input: TInput, options?: { skipLinesCheck?: boolean }): ValidationResult;
}
