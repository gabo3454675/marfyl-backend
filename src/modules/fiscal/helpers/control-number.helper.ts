/** Formato numero de control fiscal: PP-NNNNNNNN (serie de 2 digitos + 8 digitos). */
export function formatControlNumber(seriesPrefix: string, sequence: number): string {
  const prefix = String(seriesPrefix || '01')
    .replace(/\D/g, '')
    .padStart(2, '0')
    .slice(-2);
  const seq = Math.max(1, Math.floor(sequence));
  return `${prefix}-${String(seq).padStart(8, '0')}`;
}
