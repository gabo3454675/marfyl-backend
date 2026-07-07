import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  IsPositive,
} from "class-validator";
import { VariantStockBehaviorDto } from "./create-variant.dto";

export class UpdateVariantDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  salePrice?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  unitQuantity?: number;

  @IsEnum(VariantStockBehaviorDto)
  @IsOptional()
  stockBehavior?: VariantStockBehaviorDto;

  @IsBoolean()
  @IsOptional()
  inheritCost?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  customCost?: number;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsNumber()
  @Min(0)
  @IsOptional()
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
