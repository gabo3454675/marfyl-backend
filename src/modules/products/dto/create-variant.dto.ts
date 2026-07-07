import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  IsPositive,
} from "class-validator";

export enum VariantStockBehaviorDto {
  DEDUCT = "DEDUCT",
  NO_DEDUCT = "NO_DEDUCT",
}

export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  salePrice: number;

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
