import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
} from "class-validator";

export class ConfirmReceiptScanDto {
  @IsIn(["inventory", "expense"])
  mode: "inventory" | "expense";

  @IsObject()
  @IsNotEmpty()
  scan: Record<string, unknown>;

  @IsInt()
  @IsOptional()
  categoryId?: number;

  @IsInt()
  @IsOptional()
  supplierId?: number;

  @IsOptional()
  @IsIn(["PAID", "PENDING"])
  status?: "PAID" | "PENDING";
}
