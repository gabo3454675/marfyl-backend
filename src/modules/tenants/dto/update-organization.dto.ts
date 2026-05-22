import { IsNumber, Min, Max, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsNumber()
  @Min(0.0001, { message: 'La tasa debe ser mayor a 0' })
  @Max(999999.9999, { message: 'La tasa no puede ser tan alta' })
  exchangeRate?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currencyCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  currencySymbol?: string;
}
