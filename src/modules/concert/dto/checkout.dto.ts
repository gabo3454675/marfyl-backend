import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ConcertPaymentMethod } from '@prisma/client';

export class ConcertCheckoutDto {
  @IsString()
  holdToken: string;

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
  @IsEmail()
  buyerEmail?: string;

  @IsEnum(ConcertPaymentMethod)
  paymentMethod: ConcertPaymentMethod;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}

export class ConfirmOrderDto {
  @IsOptional()
  @IsString()
  note?: string;
}

export class ScanTicketDto {
  @IsString()
  @MinLength(8)
  qrPayload: string;
}
