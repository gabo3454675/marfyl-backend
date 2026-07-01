import { IsArray, IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class InvoiceUploadLineDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCostUsd?: number;

  @IsOptional()
  @IsString()
  originalName?: string;
}

export class ConfirmInvoiceUploadDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceUploadLineDto)
  lines: InvoiceUploadLineDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  supplierId?: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  createExpense?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  initialPayment?: number;
}
