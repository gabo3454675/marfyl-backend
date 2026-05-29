import { ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, MinLength } from 'class-validator';
import { ConcertPaymentMethod } from '@prisma/client';

export class AdminSellDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  seatIds: number[];

  @IsString()
  @MinLength(2)
  buyerName: string;

  @IsString()
  @MinLength(5)
  buyerIdDocument: string;

  @IsString()
  @MinLength(7)
  buyerPhone: string;

  @IsOptional()
  @IsString()
  buyerEmail?: string;

  @IsEnum(ConcertPaymentMethod)
  paymentMethod: ConcertPaymentMethod;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
