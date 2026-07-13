import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ANY_PERMISSIONS_KEY } from "@/common/decorators/any-permissions.decorator";
import {
  getPermissionsForRole,
  type PermissionKey,
  type RoleName,
} from "@/common/constants/permissions.constants";

/** Guard OR: el usuario debe tener al menos uno de los permisos indicados. */
@Injectable()
export class AnyPermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const anyPermissions = this.reflector.getAllAndOverride<PermissionKey[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!anyPermissions?.length) return true;

    const request = context.switchToHttp().getRequest();
    const membership = request.activeOrganizationMembership;
    if (!membership) {
      throw new ForbiddenException(
        "No se pudo verificar permisos. Asegúrate de enviar el header x-tenant-id.",
      );
    }

    const userRole = String(membership.role || "").toUpperCase();
    if (userRole === "SUPER_ADMIN") return true;

    const userPermissions = getPermissionsForRole(userRole as RoleName);
    const allowed = anyPermissions.some((p) => userPermissions.has(p));
    if (!allowed) {
      throw new ForbiddenException(
        `Permisos insuficientes. Se requiere alguno de: ${anyPermissions.join(", ")}`,
      );
    }
    return true;
  }
}
