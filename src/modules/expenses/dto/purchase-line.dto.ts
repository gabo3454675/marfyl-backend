import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class PurchaseLineDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  /** Costo unitario en USD al cargar inventario (opcional; si no, se usa costPrice del producto). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCostUsd?: number;
}
