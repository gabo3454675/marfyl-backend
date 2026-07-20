import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";

export class CreateAdjustmentDto {
  @IsInt()
  @Min(1)
  productId!: number;

  /** Positivo = entrada; negativo = salida. Entero ≠ 0. */
  @IsInt()
  delta!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(400)
  reason!: string;
}
