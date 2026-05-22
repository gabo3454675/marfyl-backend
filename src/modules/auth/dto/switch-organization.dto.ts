import { IsInt, Min } from 'class-validator';

export class SwitchOrganizationDto {
  @IsInt()
  @Min(1, { message: 'organizationId debe ser un entero positivo' })
  organizationId: number;
}
