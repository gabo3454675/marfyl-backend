import { IsNotEmpty, IsString, IsNumber, IsPositive } from "class-validator";
import { Type } from "class-transformer";

export class VoidInvoiceDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class AdjustAmountDto {
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  newAmount: number;

  @IsString()
  @IsNotEmpty()
  reason: string;
}
