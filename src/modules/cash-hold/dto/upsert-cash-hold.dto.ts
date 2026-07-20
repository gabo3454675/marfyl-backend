import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { CashHoldLocation } from "@prisma/client";

export class UpsertCashHoldDto {
  @IsEnum(CashHoldLocation)
  location!: CashHoldLocation;

  @IsString()
  @MaxLength(8)
  currency!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsDateString()
  asOf!: string;

  @IsString()
  @MaxLength(160)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  importKey?: string;
}
