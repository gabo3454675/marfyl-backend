import { SetMetadata } from "@nestjs/common";
import type { PermissionKey } from "@/common/constants/permissions.constants";

export const ANY_PERMISSIONS_KEY = "any_permissions";

/**
 * Requiere al menos UNO de los permisos listados (OR lógico).
 * Usar con AnyPermissionsGuard.
 */
export const AnyPermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
