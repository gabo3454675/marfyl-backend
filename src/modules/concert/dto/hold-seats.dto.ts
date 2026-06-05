import { ArrayMinSize, IsArray, IsInt } from "class-validator";

export class HoldSeatsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  seatIds: number[];
}
