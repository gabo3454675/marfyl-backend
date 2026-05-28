/** Tasas IVA Venezuela (alícuota general y reducida). */
export const IVA_GENERAL_RATE = 16;
export const IVA_REDUCED_RATE = 8;

export type TaxBucket = 'exempt' | 'reduced' | 'general';

export interface LineTaxInput {
  /** Monto de la línea sin IVA (subtotal). */
  amount: number;
  isExempt?: boolean;
  /** 0 = exento, 8 = reducida, 16 = general (por defecto). */
  taxRate?: number;
}

export interface LineTaxResult {
  taxableBase: number;
  ivaLine: number;
  taxRate: number;
  bucket: TaxBucket;
}

export interface InvoiceTaxTotals {
  baseExempt: number;
  baseReduced: number;
  baseGeneral: number;
  ivaAmount: number;
  subtotal: number;
  totalWithTax: number;
  lines: LineTaxResult[];
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeLineTax(line: LineTaxInput): LineTaxResult {
  const amount = round2(Math.max(0, line.amount));
  if (line.isExempt || line.taxRate === 0) {
    return { taxableBase: 0, ivaLine: 0, taxRate: 0, bucket: 'exempt' };
  }

  const rate = line.taxRate ?? IVA_GENERAL_RATE;
  if (rate === IVA_REDUCED_RATE) {
    const ivaLine = round2(amount * (IVA_REDUCED_RATE / 100));
    return {
      taxableBase: amount,
      ivaLine,
      taxRate: IVA_REDUCED_RATE,
      bucket: 'reduced',
    };
  }

  const ivaLine = round2(amount * (IVA_GENERAL_RATE / 100));
  return {
    taxableBase: amount,
    ivaLine,
    taxRate: IVA_GENERAL_RATE,
    bucket: 'general',
  };
}

export function computeInvoiceTax(lines: LineTaxInput[]): InvoiceTaxTotals {
  const computed = lines.map((l) => computeLineTax(l));
  let baseExempt = 0;
  let baseReduced = 0;
  let baseGeneral = 0;
  let ivaAmount = 0;
  let subtotal = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineAmount = round2(Math.max(0, lines[i].amount));
    subtotal += lineAmount;
    const r = computed[i];
    ivaAmount += r.ivaLine;
    if (r.bucket === 'exempt') {
      baseExempt += lineAmount;
    } else if (r.bucket === 'reduced') {
      baseReduced += r.taxableBase;
    } else {
      baseGeneral += r.taxableBase;
    }
  }

  return {
    baseExempt: round2(baseExempt),
    baseReduced: round2(baseReduced),
    baseGeneral: round2(baseGeneral),
    ivaAmount: round2(ivaAmount),
    subtotal: round2(subtotal),
    totalWithTax: round2(subtotal + ivaAmount),
    lines: computed,
  };
}

/** Retención IVA (75% del IVA de la factura de compra) cuando el proveedor es agente de retención. */
export function computeWithholdingIva(ivaAmount: number, rate = 0.75): number {
  return round2(Math.max(0, ivaAmount) * rate);
}
