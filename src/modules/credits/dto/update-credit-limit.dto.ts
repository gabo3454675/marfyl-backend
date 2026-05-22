import { IsNumber, Min } from 'class-validator';

export class UpdateCreditLimitDto {
  @IsNumber()
  @Min(0, { message: 'El límite debe ser mayor o igual a 0' })
  limitAmount: number;
}
