import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Guard que exige que el usuario sea Super Admin global (User.isSuperAdmin === true).
 * No depende de organización activa ni de x-tenant-id.
 * Usar junto con JwtAuthGuard para endpoints que solo el Super Admin del sistema puede ejecutar.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const isSuperAdmin = request.user?.isSuperAdmin === true;

    if (!isSuperAdmin) {
      throw new ForbiddenException(
        'Solo un Super Admin global puede ejecutar esta acción.',
      );
    }

    return true;
  }
}
