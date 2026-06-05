import { computeWithholdingIva, round2 } from "./tax-calculator";

export interface ExpenseFiscalInput {
  amount: number;
  baseExempt?: number;
  baseReduced?: number;
  baseGeneral?: number;
  ivaAmount?: number;
  isExempt?: boolean;
  applyWithholding?: boolean;
}

export interface ExpenseFiscalResult {
  baseExempt: number;
  baseReduced: number;
  baseGeneral: number;
  ivaAmount: number;
  withholdingIvaAmount: number;
}

export function computeExpenseFiscal(
  input: ExpenseFiscalInput,
): ExpenseFiscalResult {
  const amount = round2(Math.max(0, input.amount));

  if (
    input.baseGeneral != null ||
    input.ivaAmount != null ||
    input.baseExempt != null
  ) {
    const baseExempt = round2(input.baseExempt ?? 0);
    const baseReduced = round2(input.baseReduced ?? 0);
    const baseGeneral = round2(input.baseGeneral ?? 0);
    const ivaAmount = round2(input.ivaAmount ?? 0);
    const withholdingIvaAmount = input.applyWithholding
      ? computeWithholdingIva(ivaAmount)
      : 0;
    return {
      baseExempt,
      baseReduced,
      baseGeneral,
      ivaAmount,
      withholdingIvaAmount,
    };
  }

  if (input.isExempt) {
    return {
      baseExempt: amount,
      baseReduced: 0,
      baseGeneral: 0,
      ivaAmount: 0,
      withholdingIvaAmount: 0,
    };
  }

  const baseGeneral = round2(amount / 1.16);
  const ivaAmount = round2(amount - baseGeneral);
  const withholdingIvaAmount = input.applyWithholding
    ? computeWithholdingIva(ivaAmount)
    : 0;

  return {
    baseExempt: 0,
    baseReduced: 0,
    baseGeneral,
    ivaAmount,
    withholdingIvaAmount,
  };
}
