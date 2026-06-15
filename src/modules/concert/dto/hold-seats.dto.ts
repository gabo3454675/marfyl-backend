import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString } from "class-validator";

export class HoldSeatsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  seatIds: number[];

  /** Si la reserva sigue activa, extiende el mismo hold en lugar de crear uno nuevo. */
  @IsOptional()
  @IsString()
  holdToken?: string;
}

export class ExtendHoldDto {
  @IsString()
  holdToken: string;
}
