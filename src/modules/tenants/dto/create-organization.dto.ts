import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { Plan } from '@prisma/client';

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  nombre: string;

  @IsString()
  @IsNotEmpty()
  slug: string;

  @IsOptional()
  @IsEnum(Plan)
  plan?: Plan;
}
