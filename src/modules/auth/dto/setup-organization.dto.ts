import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

export class SetupOrganizationDto {
  @IsString()
  @IsNotEmpty()
  organizationName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'organizationSlug debe ser minúsculas, números y guiones',
  })
  organizationSlug: string;
}
