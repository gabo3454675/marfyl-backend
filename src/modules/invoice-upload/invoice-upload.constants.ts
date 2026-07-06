/**
 * Shared constants for invoice upload module.
 * Keeps the reason format in one place so confirm() and history queries stay in sync.
 */

/** Pattern used when creating inventory movements during invoice confirmation */
export function buildMovementReason(expenseId: number): string {
  return `Entrada por compra importada (gasto #${expenseId})`;
}

/** Pattern used to search inventory movements by expense ID in history queries */
export function buildMovementReasonSearchPattern(expenseId: number): string {
  return `gasto #${expenseId})`;
}
