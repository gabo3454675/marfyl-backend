import { IsEnum, IsNumber, IsOptional, Min } from "class-validator";
import { Type } from "class-transformer";

export class AdjustPayrollProfileDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  bonusAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  deductionAmount?: number;
}

export class UpdatePayrollProfileDto {
  @IsOptional()
  @IsEnum(["fixed", "commission", "hourly"])
  type?: "fixed" | "commission" | "hourly";

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  commission?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  hoursWorked?: number;
}
