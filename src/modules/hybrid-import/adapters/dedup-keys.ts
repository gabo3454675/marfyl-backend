/**
 * Claves de deduplicación para cada tipo de entidad Hybrid.
 * CRÍTICO: estas keys son determinísticas y estables.
 */

export function ventaDedupKey(documento: string): string {
  return `hybrid:${documento.trim()}`;
}

export function productoDedupKey(codigo: string): string {
  return `sku:${codigo.trim()}`;
}

export function clienteDedupKey(rif: string, nit: string): string {
  const taxId = rif?.trim() || nit?.trim();
  if (!taxId) {
    throw new Error('Cliente sin RIF ni NIT — no se puede deduplicar');
  }
  return `taxId:${taxId}`;
}
