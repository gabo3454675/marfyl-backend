import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  IsIn,
  IsNumber,
} from "class-validator";
import { Type } from "class-transformer";

export class FloorOrderItemDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateFloorOrderDto {
  @IsString()
  @IsNotEmpty()
  tableLabel: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => FloorOrderItemDto)
  items: FloorOrderItemDto[];

  /** Si true, crea y envía (reserva stock) en un paso */
  @IsOptional()
  @IsBoolean()
  sendNow?: boolean;
}

export class UpdateFloorOrderStatusDto {
  @IsIn(["IN_PREP", "READY"])
  status: "IN_PREP" | "READY";
}

const PAYMENT_METHODS = [
  "CASH_USD",
  "CASH_BS",
  "PAGO_MOVIL",
  "ZELLE",
  "CARD",
  "CREDIT",
] as const;
const CURRENCIES = ["USD", "VES"] as const;

export class ChargeFloorOrderPaymentDto {
  @IsString()
  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];

  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  @IsIn(CURRENCIES)
  currency: (typeof CURRENCIES)[number];
}

export class ChargeFloorOrderDto {
  @IsOptional()
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeFloorOrderPaymentDto)
  payments?: ChargeFloorOrderPaymentDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
