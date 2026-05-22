import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';

/**
 * Guard que verifica que el usuario tenga uno de los roles permitidos en la organización activa.
 * Debe usarse después de JwtAuthGuard y OrganizationGuard para que request.activeOrganizationMembership exista.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const membership = request.activeOrganizationMembership;

    if (!membership) {
      throw new ForbiddenException(
        'No se pudo verificar el rol. Asegúrate de enviar el header x-tenant-id.',
      );
    }

    const userRole = String(membership.role || '').toUpperCase();
    const hasRole = requiredRoles.some(
      (role) => String(role).toUpperCase() === userRole,
    );

    if (!hasRole) {
      throw new ForbiddenException(
        `Se requiere uno de los siguientes roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
