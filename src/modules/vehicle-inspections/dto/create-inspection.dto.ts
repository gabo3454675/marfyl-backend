import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
  IsIn,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const DIAGRAM_VIEWS = ['frontal', 'trasera', 'lateral', 'superior'] as const;
export type DiagramView = (typeof DIAGRAM_VIEWS)[number];

export const PIN_STATUS = ['damaged', 'repaired'] as const;
export type PinStatus = (typeof PIN_STATUS)[number];

export class DiagramPinDto {
  @IsIn(DIAGRAM_VIEWS)
  view: DiagramView;

  /** Posición X en porcentaje 0-100 del área del diagrama */
  @IsNumber()
  @Min(0)
  @Max(100)
  x: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  y: number;

  @IsIn(PIN_STATUS)
  status: PinStatus; // 'damaged' = Rojo, 'repaired' = Verde
}

export class UsedPartDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateInspectionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagramPinDto)
  diagramPins?: DiagramPinDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UsedPartDto)
  usedParts?: UsedPartDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vehicleInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
