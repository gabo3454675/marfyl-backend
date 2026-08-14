import { IsNumber, Min, IsOptional } from "class-validator";
import { Type } from "class-transformer";

export class AperturaCajaDto {
  @IsNumber()
  @Min(0, { message: "montoInicial debe ser mayor o igual a 0" })
  @Type(() => Number)
  montoInicial: number;

  @IsOptional()
  @IsNumber()
  @Min(0, { message: "montoInicialBs debe ser mayor o igual a 0" })
  @Type(() => Number)
  montoInicialBs?: number;
}
