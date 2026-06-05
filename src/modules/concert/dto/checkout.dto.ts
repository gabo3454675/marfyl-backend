import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { ConcertPaymentMethod } from "@prisma/client";
import { IsSafeText } from "@/common/validators/safe-text.validator";

export class ConcertCheckoutDto {
  @IsString()
  holdToken: string;

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
