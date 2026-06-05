import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { FiscalTaxpayerType } from "@prisma/client";

export class UpsertFiscalProfileDto {
  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsEnum(FiscalTaxpayerType)
  taxpayerType?: FiscalTaxpayerType;

  @IsOptional()
  @IsBoolean()
  isWithholdingAgent?: boolean;

  @IsOptional()
  @IsBoolean()
  isSubjectToWithholding?: boolean;

  @IsOptional()
  @IsBoolean()
  isSpecialTaxpayer?: boolean;

  @IsOptional()
  @IsBoolean()
  isFormalTaxpayer?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9)
  rifLastDigit?: number;

  @IsOptional()
  @IsString()
  controlSeriesPrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextControlSequence?: number;

  @IsOptional()
  @IsString()
  economicActivity?: string;

  @IsOptional()
  @IsArray()
  branches?: Record<string, unknown>[];
}
