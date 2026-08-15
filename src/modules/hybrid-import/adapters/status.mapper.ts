import { InvoiceStatus } from '@prisma/client';

/**
 * Mapeo de status Hybrid → Marfyl InvoiceStatus.
 *
 * Hybrid status codes:
 *   0 = Anulado
 *   1 = Procesado (completado)
 *   2 = Anulado (variante)
 *   5 = En proceso
 */
const STATUS_MAP: Record<number, InvoiceStatus> = {
  0: 'CANCELLED',
  1: 'PAID',
  2: 'CANCELLED',
  5: 'PENDING',
};

export function mapHybridStatus(hybridStatus: number): InvoiceStatus {
  return STATUS_MAP[hybridStatus] ?? 'PENDING';
}

/**
 * ¿Es importable este status?
 * Anulados NO se importan (skip, no error).
 */
export function isImportableStatus(hybridStatus: number): boolean {
  return hybridStatus === 1 || hybridStatus === 5;
}
