import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '@/common/decorators/permissions.decorator';
import {
  getPermissionsForRole,
  type PermissionKey,
  type RoleName,
} from '@/common/constants/permissions.constants';

/**
 * Guard que verifica que el usuario tenga TODOS los permisos requeridos.
 * Debe usarse DESPUÉS de JwtAuthGuard y OrganizationGuard.
 *
 * Flujo:
 * 1. Lee permisos del metadata (decorator @Permissions)
 * 2. Si no hay metadata, permite acceso (sin restricción)
 * 3. Obtiene el rol del membership activo
 * 4. Resuelve permisos del rol desde ROLE_PERMISSIONS_MAP
 * 5. Verifica que TODOS los permisos requeridos estén presentes
 * 6. Si falta algún permiso, lanza ForbiddenException
 *
 * Comportamiento especial:
 * - SUPER_ADMIN bypasea todos los permisos (acceso total)
 * - Permiso inexistente en el mapa = denegado por defecto
 * - Sin membership activa = denegado
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Sin metadata = sin restricción de permisos
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const membership = request.activeOrganizationMembership;

    if (!membership) {
      throw new ForbiddenException(
        'No se pudo verificar permisos. Asegúrate de enviar el header x-tenant-id.',
      );
    }

    const userRole = String(membership.role || '').toUpperCase();

    // SUPER_ADMIN bypasea todos los permisos
    if (userRole === 'SUPER_ADMIN') {
      return true;
    }

    const userPermissions = getPermissionsForRole(userRole as RoleName);

    const missingPermissions = requiredPermissions.filter(
      (p) => !userPermissions.has(p as PermissionKey),
    );

    if (missingPermissions.length > 0) {
      throw new ForbiddenException(
        `Permisos insuficientes. Se requieren: ${missingPermissions.join(', ')}`,
      );
    }

    return true;
  }
}
