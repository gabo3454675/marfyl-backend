import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class PerfilEmpresaDto {
  @IsOptional()
  @IsString()
  RIF?: string;

  @IsOptional()
  @IsBoolean()
  esEspecial?: boolean;

  @IsOptional()
  @IsString()
  actividadPrincipal?: string;

  @IsOptional()
  @IsString()
  tipoFacturacion?: string;
}

export class ResumenOperativoDto {
  @IsOptional()
  @IsNumber()
  totalFacturadoMes?: number;

  @IsOptional()
  @IsNumber()
  pagosDivisasEfectivo?: number;

  @IsOptional()
  @IsNumber()
  igtfRecaudado?: number;

  @IsOptional()
  @IsDateString()
  ultimaDeclaracionIVA?: string | null;

  @IsOptional()
  @IsNumber()
  facturasSinMaquinaFiscal?: number;
}

export class FiscalAdvisorDto {
  @IsOptional()
  @IsString()
  mensajeUsuario?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PerfilEmpresaDto)
  perfilEmpresa?: PerfilEmpresaDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ResumenOperativoDto)
  resumenOperativo?: ResumenOperativoDto;
}
