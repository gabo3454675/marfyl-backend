import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Define los roles permitidos para acceder a la ruta.
 * Requiere OrganizationGuard (para tener activeOrganizationMembership) y RolesGuard.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
