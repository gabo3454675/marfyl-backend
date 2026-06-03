import { ArrayMinSize, IsArray, IsEmail, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ConcertPaymentMethod } from '@prisma/client';
import { IsSafeText } from '@/common/validators/safe-text.validator';

export class AdminSellDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  seatIds: number[];

  @IsString()
  @MinLength(2)
  @IsSafeText()
  buyerName: string;

  @IsString()
  @MinLength(5)
  buyerIdDocument: string;

  @IsString()
  @MinLength(7)
  @IsSafeText()
  buyerPhone: string;

  @IsEmail()
  @IsNotEmpty()
  buyerEmail: string;

  @IsEnum(ConcertPaymentMethod)
  paymentMethod: ConcertPaymentMethod;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
