import { IsBoolean, IsOptional, IsString } from "class-validator";

export class ConfirmSalesImportDto {
  @IsString()
  batchId!: string;

  @IsOptional()
  @IsBoolean()
  allowWarnings?: boolean;

  @IsOptional()
  @IsBoolean()
  skipStockValidation?: boolean;
}
