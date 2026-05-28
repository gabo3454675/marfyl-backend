import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class PreventiveValidationDto {
  @IsEnum(['sale', 'purchase', 'credit_note', 'period_close'])
  operation!: 'sale' | 'purchase' | 'credit_note' | 'period_close';

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsDateString()
  documentDate?: string;

  @IsOptional()
  @IsString()
  controlNumber?: string;

  @IsOptional()
  @IsNumber()
  amountBs?: number;
}
