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
  zone?: string;

  @IsOptional()
  @IsString()
  @IsIn(["INMEDIATO", "CUENTA_ABIERTA"])
  paymentMode?: "INMEDIATO" | "CUENTA_ABIERTA";

  /** Cédula del cliente para buscar o crear (requerido para CUENTA_ABIERTA) */
  @IsOptional()
  @IsString()
  customerTaxId?: string;

  /** Para auto-registro rápido de cliente */
  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  customerFirstName?: string;

  @IsOptional()
  @IsString()
  customerLastName?: string;

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

export class ChargeCustomerOpenTabDto {
  // customerId viene del path param, no del body

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

export class QuickRegisterCustomerDto {
  @IsString()
  @IsNotEmpty()
  taxId: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;
}
