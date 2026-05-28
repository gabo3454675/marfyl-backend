import { BadRequestException } from '@nestjs/common';

/** Valida RIF venezolano basico (J/G/E/V/P + digitos + verificador). */
export function validateRifFormat(rif: string | null | undefined): boolean {
  if (!rif?.trim()) return false;
  return /^[VEJGPvejgp]-?\d{7,9}-?\d$/i.test(rif.trim().replace(/\s/g, ''));
}

export function assertRifOrWarn(rif: string | null | undefined, fieldName: string): void {
  if (!rif?.trim()) return;
  if (!validateRifFormat(rif)) {
    throw new BadRequestException(`${fieldName}: formato de RIF no válido`);
  }
}

export function rifLastDigitFromTaxId(taxId: string | null | undefined): number | null {
  if (!taxId) return null;
  const digits = taxId.replace(/\D/g, '');
  if (!digits.length) return null;
  return Number(digits[digits.length - 1]);
}
