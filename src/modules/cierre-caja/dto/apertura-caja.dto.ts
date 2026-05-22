import { IsNumber, Min } from 'class-validator';

export class AperturaCajaDto {
  @IsNumber()
  @Min(0, { message: 'montoInicial debe ser mayor o igual a 0' })
  montoInicial: number;
}
