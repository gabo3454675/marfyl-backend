/**
 * Contexto inmutable que acompaña cada operación de importación.
 * Propagado por el orchestrator, nunca construido por los adapters.
 */
export interface ImportContext {
  /** Organización destino (tenant) */
  readonly organizationId: number;

  /** Company legacy (requerido por schema Prisma) */
  readonly companyId: number;

  /** Usuario que ejecuta la importación */
  readonly userId: number;

  /** Tasa de cambio USD/VES al momento de importar */
  readonly exchangeRate: number;

  /** Código ISO de moneda (USD, VES) */
  readonly currencyCode: string;

  /** Origen identificador para importSource field */
  readonly importSource: 'hybrid';

  /** Slug de org para lógica condicional */
  readonly orgSlug: string;
}
