import {
  IsOptional,
  IsNumber,
  IsString,
  IsInt,
  IsEnum,
  IsDateString,
  Min,
} from 'class-validator';
import { ExpenseStatus } from '@prisma/client';

export class UpdateExpenseDto {
  @IsDateString()
  @IsOptional()
  date?: string;

  @IsNumber()
  @IsOptional()
  @Min(0.01)
  amount?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsEnum(ExpenseStatus)
  @IsOptional()
  status?: ExpenseStatus;

  @IsInt()
  @IsOptional()
  supplierId?: number;

  @IsInt()
  @IsOptional()
  categoryId?: number;
}
