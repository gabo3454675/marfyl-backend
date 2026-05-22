import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RegisterPaymentDto {
  @IsNumber()
  @Min(0.01, { message: 'El monto debe ser mayor a 0' })
  amountUsd: number;

  @IsNumber()
  @Min(0)
  amountBs: number;

  @IsNumber()
  @Min(0)
  exchangeRate: number;

  @IsOptional()
  @IsString()
  description?: string;

  /** Si se envía, el abono se asocia a esta factura (para cerrar tarea de cobranza cuando quede saldada). */
  @IsOptional()
  @IsNumber()
  invoiceId?: number;
}
