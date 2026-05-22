import { IsInt, Min } from 'class-validator';

export class ClearInventoryDto {
  @IsInt()
  @Min(1, { message: 'tenantId debe ser un entero positivo' })
  tenantId: number;
}
