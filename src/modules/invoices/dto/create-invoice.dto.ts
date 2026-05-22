import {
  IsArray,
  IsNotEmpty,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
  IsNumber,
  IsIn,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInvoiceItemDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

const PAYMENT_METHODS = ['CASH_USD', 'CASH_BS', 'PAGO_MOVIL', 'ZELLE', 'CARD', 'CREDIT'] as const;
const CURRENCIES = ['USD', 'VES'] as const;

export class CreateInvoicePaymentLineDto {
  @IsString()
  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];
}

export class CreateInvoiceDto {
  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoiceItemDto)
  items: CreateInvoiceItemDto[];

  @IsOptional()
  notes?: string;

  /**
   * Legacy: un solo método (CASH, ZELLE, CARD, CREDIT).
   * Si se envía "payments", se usa registro dual multimoneda (híbrido).
   */
  @IsOptional()
  paymentMethod?: string;

  /**
   * Pagos híbridos: ej. $10 efectivo + Bs Pago Móvil.
   * Cada línea: method (CASH_USD, CASH_BS, PAGO_MOVIL, ZELLE, CARD, CREDIT), amount, currency (USD|VES).
   * La suma en USD (monto USD + monto VES/tasa) debe coincidir con el total de la factura.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateInvoicePaymentLineDto)
  payments?: CreateInvoicePaymentLineDto[];
}
