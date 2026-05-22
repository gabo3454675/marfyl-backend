import { IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateMemberRoleDto {
  @IsEnum(Role, { message: 'newRole debe ser ADMIN, MANAGER, SELLER o WAREHOUSE' })
  newRole: Role;
}
