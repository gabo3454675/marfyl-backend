import { IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class CierreCajaZDto {
  /** Efectivo USD contado (compat: si solo se envía esto, se usa como monto físico USD). */
  @IsOptional()
  @IsNumber()
  montoFisico?: number;

  @IsOptional()
  @IsNumber()
  montoFisicoUsd?: number;

  @IsOptional()
  @IsNumber()
  montoFisicoVes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'observaciones no puede superar 1000 caracteres' })
  observaciones?: string;
}
