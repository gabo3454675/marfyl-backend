import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsDateString,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ExpenseStatus } from '@prisma/client';
import { PurchaseLineDto } from './purchase-line.dto';

export class CreateExpenseDto {
  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(0.01)
  amount: number;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsEnum(ExpenseStatus)
  @IsOptional()
  status?: ExpenseStatus;

  @IsInt()
  @IsOptional()
  supplierId?: number;

  @IsInt()
  @IsNotEmpty()
  categoryId: number;

  /** Líneas de entrada de inventario (factura de compra): crea movimientos COMPRA y suma stock. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineDto)
  purchaseLines?: PurchaseLineDto[];

  /** Abono inicial al registrar el gasto (cuentas por pagar). */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  initialPayment?: number;
}
