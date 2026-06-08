/** Datos de cobro Monddy / Inversiones Hemenegilda S.A — Banco del Tesoro. */
export const MONDY_CONCERT_PAYMENT = {
  bankAccountName: "Inversiones Hemenegilda S.A",
  /** RIF jurídico (tipo J) — requerido en pago móvil y transferencia. */
  rif: "J-405144823",
  bankName: "Banco del Tesoro",
  accountNumber: "010630707667073012556",
  pagoMovilPhone: "0412-7572592",
} as const;

export function monddyBankTransferInfo(): string {
  const p = MONDY_CONCERT_PAYMENT;
  return `${p.bankName} · Cuenta ${p.accountNumber} · RIF ${p.rif} (tipo J) · Tel. ${p.pagoMovilPhone}`;
}

export function monddyPagoMovilInfo(): string {
  const p = MONDY_CONCERT_PAYMENT;
  return `Pago móvil — ${p.bankName} · Tel. ${p.pagoMovilPhone} · RIF ${p.rif} (tipo J — jurídico) · Titular: ${p.bankAccountName}`;
}

export function monddyConcertPaymentFields() {
  return {
    bankAccountName: MONDY_CONCERT_PAYMENT.bankAccountName,
    bankAccountInfo: monddyBankTransferInfo(),
    pagoMovilInfo: monddyPagoMovilInfo(),
  };
}
