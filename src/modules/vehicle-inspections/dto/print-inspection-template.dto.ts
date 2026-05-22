import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class PrintInspectionTemplateDto {
  @IsObject()
  payload: Record<string, unknown>;

  @IsOptional()
  @IsString()
  signatureDataUrl?: string;

  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}

