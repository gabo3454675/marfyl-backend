import {
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DiagramPinDto } from './create-inspection.dto';

export class UpdateInspectionDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagramPinDto)
  diagramPins?: DiagramPinDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vehicleInfo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  notes?: string;
}

