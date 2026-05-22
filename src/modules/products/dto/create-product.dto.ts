import { IsString, IsNotEmpty, IsOptional, IsNumber, IsPositive, Min, IsIn, IsBoolean } from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  salePrice: number;

  /** Moneda en que se registra el precio: USD o VES (Bolívares). Por defecto USD. */
  @IsString()
  @IsOptional()
  @IsIn(['USD', 'VES'], { message: 'salePriceCurrency debe ser USD o VES' })
  salePriceCurrency?: 'USD' | 'VES';

  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  costPrice?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  stock?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minStock?: number;

  @IsOptional()
  @IsBoolean()
  isBundle?: boolean;

  /** Venta sin descuento de stock del ítem (p. ej. servicio en bar). No aplica si isBundle es true. */
  @IsOptional()
  @IsBoolean()
  isService?: boolean;

  /**
   * [{ "productId": number, "quantity": number }] por unidad vendida.
   * Combo: obligatorio. Servicio: opcional (descorche + hielo/jugo, etc.); si se omite o va vacío, solo cobra sin mover stock.
   */
  @IsOptional()
  bundleComponents?: unknown;
}
