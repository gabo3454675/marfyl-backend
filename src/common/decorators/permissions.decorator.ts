import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@/common/constants/permissions.constants';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Define los permisos requeridos para acceder a la ruta.
 * Debe usarse con PermissionsGuard.
 *
 * @example
 * @Permissions('canManageInvoices')
 * @Post()
 * async create(...) {}
 *
 * @example
 * @Permissions('canViewDashboard', 'canViewReports')
 * // Requiere TODOS los permisos (AND lógico)
 * @Get()
 * async findAll(...) {}
 */
export const Permissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
