import { IsInt, IsOptional, IsString, Min, MaxLength, IsNumber, IsEnum, IsBoolean } from 'class-validator';
import { IsIn } from 'class-validator';
import { ConsumptionReason } from '@prisma/client';

/** Tipos de salida permitidos (Autoconsumo, Mermas, Uso taller). */
export const OUTFLOW_MOVEMENT_TYPES = [
  'AUTOCONSUMO',
  'MERMA_VENCIDO',
  'MERMA_DANADO',
  'USO_TALLER',
] as const;

export type OutflowMovementType = (typeof OUTFLOW_MOVEMENT_TYPES)[number];

export const CONSUMPTION_REASON_VALUES: ConsumptionReason[] = ['MERMA', 'MUESTRAS', 'USO_OPERATIVO'];

export class CreateMovementDto {
  @IsIn(OUTFLOW_MOVEMENT_TYPES, {
    message: `type debe ser uno de: ${OUTFLOW_MOVEMENT_TYPES.join(', ')}`,
  })
  type: OutflowMovementType;

  @IsInt()
  @Min(1, { message: 'quantity debe ser al menos 1' })
  quantity: number;

  @IsInt()
  @Min(1, { message: 'productId es requerido' })
  productId: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'reason no puede superar 500 caracteres' })
  reason?: string;

  /** Costo unitario al momento de la transacción (trazabilidad). Si no se envía, se usa costPrice del producto. */
  @IsOptional()
  @IsNumber()
  @Min(0, { message: 'unitCostAtTransaction debe ser >= 0' })
  unitCostAtTransaction?: number;

  /** Clasificación para dashboard: merma, muestras, uso operativo. */
  @IsOptional()
  @IsEnum(ConsumptionReason, { message: 'consumptionReason debe ser MERMA, MUESTRAS o USO_OPERATIVO' })
  consumptionReason?: ConsumptionReason;

  /**
   * Si es true: el stock en `products` ya fue ajustado (p. ej. despacho DISIS en el monolito).
   * Solo se crean InventoryMovement + gasto + logs; no se vuelve a descontar stock.
   * Requiere cabecera `x-disis-dispatch-secret` igual a `DISIS_DISPATCH_SHARED_SECRET` en el servidor.
   */
  @IsOptional()
  @IsBoolean()
  stockAlreadyAdjusted?: boolean;
}
