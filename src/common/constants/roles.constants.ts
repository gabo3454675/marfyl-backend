/**
 * Fuente de verdad: Roles y permisos - Disis SaaS Multi-Tenant
 *
 * Roles en BD (Prisma enum Role): SUPER_ADMIN, ADMIN, FISCAL, MANAGER, SELLER, WAREHOUSE
 * A nivel de permisos/documentación: USER = SELLER | WAREHOUSE (roles operativos).
 */

/** Roles almacenados en BD (coinciden con Prisma enum Role) */
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  FISCAL: "FISCAL",
  MANAGER: "MANAGER",
  SELLER: "SELLER",
  WAREHOUSE: "WAREHOUSE",
  POS_OPERATOR: "POS_OPERATOR",
  WAITER: "WAITER",
  KITCHEN: "KITCHEN",
} as const;

export type RoleKey = keyof typeof ROLES;
export type RoleValue = (typeof ROLES)[RoleKey];

/** Roles considerados "USER" a nivel lógico (operativos, sin gestión de equipo/empresa) */
export const USER_ROLES: RoleValue[] = [ROLES.SELLER, ROLES.WAREHOUSE];

/** Peso jerárquico: mayor = más autoridad. Usado para ordenar y validar asignación de tareas. */
export const ROLE_ORDER: Record<string, number> = {
  [ROLES.SUPER_ADMIN]: 5,
  [ROLES.ADMIN]: 4,
  [ROLES.FISCAL]: 3,
  [ROLES.MANAGER]: 3,
  [ROLES.SELLER]: 2,
  [ROLES.POS_OPERATOR]: 2,
  [ROLES.WAITER]: 2,
  [ROLES.KITCHEN]: 2,
  [ROLES.WAREHOUSE]: 1,
};

/** Puestos de piso/caja/almacén. El gerente los cubre; no toca Admin ni Super Admin. */
export const OPERATIONAL_ROLES: RoleValue[] = [
  ROLES.SELLER,
  ROLES.WAREHOUSE,
  ROLES.POS_OPERATOR,
  ROLES.WAITER,
  ROLES.KITCHEN,
];

export function isOperationalRole(role: string | undefined): boolean {
  return OPERATIONAL_ROLES.includes(normalizeRole(role) as RoleValue);
}

/**
 * ¿Puede este actor asignar o tocar a alguien con `targetRole`?
 * Super Admin: todo. Admin: todo salvo Super Admin y otros Admin.
 * Gerente: solo puestos operativos.
 */
export function canManageStaffRole(
  actorRole: string | undefined,
  targetRole: string | undefined,
): boolean {
  const actor = normalizeRole(actorRole);
  const target = normalizeRole(targetRole);
  if (!target) return false;
  if (actor === ROLES.SUPER_ADMIN) return true;
  if (target === ROLES.SUPER_ADMIN) return false;
  if (actor === ROLES.ADMIN) return target !== ROLES.ADMIN;
  if (actor === ROLES.MANAGER) return isOperationalRole(target);
  return false;
}

export interface RolePermissions {
  /** Acceso total (Super Admin) */
  isSuperAdmin: boolean;
  /** Gestionar usuarios: invitar, desactivar, cambiar roles. No puede eliminar SUPER_ADMIN. */
  canManageUsers: boolean;
  /** Equipo del local: gerente invita/cambia puestos de piso, no admins. */
  canManageStaff: boolean;
  /** Editar configuración de empresa: tasa BCV, impuestos, etc. */
  canEditOrganizationSettings: boolean;
  /** Gestionar inventario (productos, stock, import/export) */
  canManageInventory: boolean;
  /** Gestionar ventas (POS, facturas, clientes) */
  canManageSales: boolean;
  /** Asignar tareas a otros miembros */
  canAssignTasks: boolean;
  /** Ver lista de miembros (según visibilidad por rol) */
  canViewMembers: boolean;
  /** Crear nuevas organizaciones (solo flag isSuperAdmin en User) */
  canCreateOrganization: boolean;
  /** Si puede desactivar/eliminar a un usuario con rol SUPER_ADMIN (solo SUPER_ADMIN) */
  canDeleteSuperAdmin: boolean;
}

function normalizeRole(role: string | undefined): string {
  return String(role ?? "")
    .toUpperCase()
    .trim();
}

/**
 * Devuelve la matriz de permisos para un rol dado.
 * - SUPER_ADMIN: acceso total.
 * - ADMIN: usuarios (sin eliminar SUPER_ADMIN), configuración empresa. No crear organizaciones.
 * - MANAGER: administrador del local (equipo operativo + tasa). No Super Admin ni fiscal.
 * - SELLER/WAREHOUSE (USER): operativos según contexto; no gestionan equipo ni configuración.
 */
export function getPermissions(role: string | undefined): RolePermissions {
  const r = normalizeRole(role);
  const isSuperAdmin = r === ROLES.SUPER_ADMIN;
  const isAdmin = r === ROLES.ADMIN;
  const isManager = r === ROLES.MANAGER;

  return {
    isSuperAdmin,
    canManageUsers: isSuperAdmin || isAdmin,
    canManageStaff: isSuperAdmin || isAdmin || isManager,
    canEditOrganizationSettings: isSuperAdmin || isAdmin || isManager,
    canManageInventory:
      isSuperAdmin || isAdmin || isManager || r === ROLES.WAREHOUSE,
    canManageSales: isSuperAdmin || isAdmin || isManager || r === ROLES.SELLER,
    canAssignTasks: isSuperAdmin || isAdmin || isManager,
    canViewMembers: isSuperAdmin || isAdmin || isManager, // MANAGER ve solo SELLER/WAREHOUSE; lógica en getMembers
    canCreateOrganization: isSuperAdmin, // Además se valida User.isSuperAdmin en backend
    canDeleteSuperAdmin: isSuperAdmin,
  };
}

/** Peso numérico del rol (para ordenar y comparar jerarquía). */
export function getRoleOrder(role: string | undefined): number {
  return ROLE_ORDER[normalizeRole(role)] ?? 0;
}

/** Indica si el rol puede gestionar usuarios (invitar, cambiar rol, desactivar). */
export function canManageUsers(role: string | undefined): boolean {
  return getPermissions(role).canManageUsers;
}

/** Indica si el rol puede desactivar/eliminar a un miembro con rol SUPER_ADMIN. */
export function canDeleteSuperAdmin(role: string | undefined): boolean {
  return getPermissions(role).canDeleteSuperAdmin;
}

/** Roles que pueden ver la lista de miembros (el contenido se filtra en getMembers por rol). */
export function canViewMembersList(role: string | undefined): boolean {
  const r = normalizeRole(role);
  return r === ROLES.SUPER_ADMIN || r === ROLES.ADMIN || r === ROLES.MANAGER;
}

/** Roles que pueden cambiar roles o desactivar miembros (ADMIN no puede tocar SUPER_ADMIN). */
export const ROLES_CAN_MANAGE_MEMBERS: RoleValue[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** Roles que pueden editar configuración de organización (tasa BCV, etc.). */
export const ROLES_CAN_EDIT_ORGANIZATION: RoleValue[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.MANAGER,
];
