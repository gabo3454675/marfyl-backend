import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

const EDITABLE_PAYMENT_METHODS = [
  "CASH_USD",
  "CASH_BS",
  "PAGO_MOVIL",
  "ZELLE",
  "CARD",
] as const;

export class UpdateInvoicePaymentDto {
  @IsString()
  @IsIn(EDITABLE_PAYMENT_METHODS)
  method: (typeof EDITABLE_PAYMENT_METHODS)[number];
}

/** Corrección operativa: notas y/o método de pago. No cambia ítems ni total. */
export class UpdateInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * Un método por cada línea de pago existente (mismos montos y moneda).
   * No se puede pasar a crédito ni cambiar USD ↔ Bs.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateInvoicePaymentDto)
  payments?: UpdateInvoicePaymentDto[];
}
