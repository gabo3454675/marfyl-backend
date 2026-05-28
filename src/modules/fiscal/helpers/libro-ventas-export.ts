import type { LibroVentaLine } from '@prisma/client';

export interface LibroVentaRowView {
  id: number;
  opNumber: string;
  issueDate: Date;
  customerTaxId: string | null;
  customerName: string | null;
  invoiceNumber: string | null;
  controlNumber: string | null;
  baseExempt: number;
  baseGeneral: number;
  ivaAmount: number;
  totalAmount: number;
  source: 'POS' | 'MANUAL';
  validationErrors: string[];
  validationWarnings: string[];
}

export function enrichLibroVentaLine(
  line: LibroVentaLine & { invoice?: { id: number; consecutiveNumber: number | null } | null },
  index: number,
): LibroVentaRowView {
  const baseExempt = Number(line.baseExempt);
  const baseGeneral = Number(line.baseGeneral);
  const ivaAmount = Number(line.ivaAmount);
  const totalAmount = Number(line.totalAmount);
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  if (baseGeneral > 0 && !line.customerTaxId?.trim()) {
    validationErrors.push('Falta RIF del cliente en operación gravada');
  }
  if (!line.controlNumber?.trim()) {
    validationWarnings.push('Sin número de control fiscal');
  }

  return {
    id: line.id,
    opNumber: String(index + 1).padStart(3, '0'),
    issueDate: line.issueDate,
    customerTaxId: line.customerTaxId,
    customerName: line.customerName,
    invoiceNumber: line.invoiceNumber,
    controlNumber: line.controlNumber,
    baseExempt,
    baseGeneral,
    ivaAmount,
    totalAmount,
    source: line.invoiceId ? 'POS' : 'MANUAL',
    validationErrors,
    validationWarnings,
  };
}

export function buildLibroVentasTxt(rows: LibroVentaRowView[], year: number, month: number): string {
  const header = `LIBRO DE VENTAS MARFYL - PERIODO ${String(month).padStart(2, '0')}/${year}`;
  const cols = [
    'N_OP',
    'FECHA',
    'RIF',
    'RAZON_SOCIAL',
    'N_FACTURA',
    'N_CONTROL',
    'VENTAS_EXENTAS',
    'BASE_IMPONIBLE_16',
    'IVA_CAUSADO',
    'TOTAL_BS',
  ];
  const lines = [header, cols.join('\t')];

  for (const r of rows) {
    const fecha = r.issueDate.toISOString().slice(0, 10).split('-').reverse().join('/');
    lines.push(
      [
        r.opNumber,
        fecha,
        r.customerTaxId ?? '',
        (r.customerName ?? '').replace(/\t/g, ' '),
        r.invoiceNumber ?? '',
        r.controlNumber ?? '',
        r.baseExempt.toFixed(2),
        r.baseGeneral.toFixed(2),
        r.ivaAmount.toFixed(2),
        r.totalAmount.toFixed(2),
      ].join('\t'),
    );
  }

  const tEx = rows.reduce((s, r) => s + r.baseExempt, 0);
  const tBase = rows.reduce((s, r) => s + r.baseGeneral, 0);
  const tIva = rows.reduce((s, r) => s + r.ivaAmount, 0);
  const tTot = rows.reduce((s, r) => s + r.totalAmount, 0);
  lines.push(
    '',
    `TOTALES\t\t\t\t\t\t${tEx.toFixed(2)}\t${tBase.toFixed(2)}\t${tIva.toFixed(2)}\t${tTot.toFixed(2)}`,
  );

  return lines.join('\r\n');
}
