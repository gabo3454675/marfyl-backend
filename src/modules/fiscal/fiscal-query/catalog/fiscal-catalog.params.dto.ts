import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
} from "class-validator";

/**
 * DTO de params para `vat_debts_by_month`.
 * `year` debe ser un entero razonable (1900–2100).
 */
export class VatDebtsByMonthParamsDto {
  @IsInt()
  @Min(1900)
  @Max(2100)
  year!: number;
}

/**
 * DTO de params para `withholding_summary_by_supplier`.
 * `fromDate`/`toDate` son fechas ISO-8601 (string). La validación cruzada
 * (toDate >= fromDate) se realiza en el servicio.
 */
export class WithholdingSummaryBySupplierParamsDto {
  @IsString()
  @IsNotEmpty()
  @IsDateString()
  fromDate!: string;

  @IsString()
  @IsNotEmpty()
  @IsDateString()
  toDate!: string;
}
