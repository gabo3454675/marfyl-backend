import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class RegisterExpensePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
