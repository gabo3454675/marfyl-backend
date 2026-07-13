import { IsBoolean, IsOptional } from "class-validator";

export class ConfirmPurchasesImportDto {
  @IsOptional()
  @IsBoolean()
  skipImported?: boolean;
}
