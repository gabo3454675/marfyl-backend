import { IsString, IsNotEmpty, IsOptional, IsEnum } from "class-validator";
import { ConcertOrderStatus, ConcertPaymentMethod } from "@prisma/client";

/** DTO para búsqueda de órdenes por nombre/documento del comprador */
export class SearchOrdersDto {
  @IsString()
  @IsNotEmpty()
  q: string;
}

/** DTO para query params del listado de órdenes admin */
export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(ConcertOrderStatus)
  status?: ConcertOrderStatus;

  @IsOptional()
  @IsEnum(ConcertPaymentMethod)
  paymentMethod?: ConcertPaymentMethod;

  @IsOptional()
  @IsString()
  paymentReference?: string;
}
