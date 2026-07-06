/**
 * Permission constants for the MARFYL application.
 *
 * This file defines all permissions, the role-permission mapping,
 * and utility functions for permission checking.
 *
 * IMPORTANT: This file does NOT import from roles.constants.ts
 * to avoid circular dependencies.
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Union type of all valid permission keys.
 * Each permission follows the format: can{Action}{Resource}
 */
export type PermissionKey =
  | 'canViewDashboard'
  | 'canViewFinancialCharts'
  | 'canViewReports'
  | 'canManageProducts'
  | 'canViewProducts'
  | 'canManageInventory'
  | 'canManageCustomers'
  | 'canManageInvoices'
  | 'canAnulateInvoices'
  | 'canDeleteInvoices'
  | 'canViewCredits'
  | 'canManageCredits'
  | 'canManageCierreCaja'
  | 'canManageExpenses'
  | 'canManageTeam'
  | 'canManageSettings'
  | 'canInviteMembers'
  | 'canAssignTasks'
  | 'canCreateOrganization'
  | 'canManageFiscal';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Array containing all valid permission keys.
 * Use this for validation or iteration over all permissions.
 */
export const ALL_PERMISSIONS: readonly PermissionKey[] = [
  'canViewDashboard',
  'canViewFinancialCharts',
  'canViewReports',
  'canManageProducts',
  'canViewProducts',
  'canManageInventory',
  'canManageCustomers',
  'canManageInvoices',
  'canAnulateInvoices',
  'canDeleteInvoices',
  'canViewCredits',
  'canManageCredits',
  'canManageCierreCaja',
  'canManageExpenses',
  'canManageTeam',
  'canManageSettings',
  'canInviteMembers',
  'canAssignTasks',
  'canCreateOrganization',
  'canManageFiscal',
] as const;

/**
 * Role names used in the permission map.
 * These match the Prisma Role enum values.
 */
export type RoleName =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGER'
  | 'SELLER'
  | 'WAREHOUSE'
  | 'POS_OPERATOR'
  | 'FISCAL';

/**
 * Mapping of roles to their assigned permissions.
 *
 * NOTE: POS_OPERATOR is included here for future Prisma enum integration,
 * even though it doesn't exist in the database yet.
 */
export const ROLE_PERMISSIONS_MAP = {
  SUPER_ADMIN: [
    'canViewDashboard',
    'canViewFinancialCharts',
    'canViewReports',
    'canManageProducts',
    'canViewProducts',
    'canManageInventory',
    'canManageCustomers',
    'canManageInvoices',
    'canAnulateInvoices',
    'canDeleteInvoices',
    'canViewCredits',
    'canManageCredits',
    'canManageCierreCaja',
    'canManageExpenses',
    'canManageTeam',
    'canManageSettings',
    'canInviteMembers',
    'canAssignTasks',
    'canCreateOrganization',
    'canManageFiscal',
  ] as const,

  ADMIN: [
    'canViewDashboard',
    'canViewFinancialCharts',
    'canViewReports',
    'canManageProducts',
    'canViewProducts',
    'canManageInventory',
    'canManageCustomers',
    'canManageInvoices',
    'canAnulateInvoices',
    'canDeleteInvoices',
    'canViewCredits',
    'canManageCredits',
    'canManageCierreCaja',
    'canManageExpenses',
    'canManageTeam',
    'canManageSettings',
    'canInviteMembers',
    'canAssignTasks',
    'canManageFiscal',
  ] as const,

  MANAGER: [
    'canViewDashboard',
    'canViewFinancialCharts',
    'canViewReports',
    'canManageProducts',
    'canViewProducts',
    'canManageInventory',
    'canManageCustomers',
    'canManageInvoices',
    'canViewCredits',
    'canManageCierreCaja',
    'canManageExpenses',
    'canAssignTasks',
  ] as const,

  SELLER: [
    'canViewDashboard',
    'canViewProducts',
    'canManageCustomers',
    'canManageInvoices',
    'canViewCredits',
    'canManageCierreCaja',
  ] as const,

  WAREHOUSE: [
    'canViewDashboard',
    'canManageProducts',
    'canViewProducts',
    'canManageInventory',
  ] as const,

  POS_OPERATOR: [
    'canViewDashboard',
    'canViewProducts',
    'canManageInvoices',
    'canManageCierreCaja',
  ] as const,

  FISCAL: [
    'canViewDashboard',
    'canManageFiscal',
  ] as const,
} as const;

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Returns the set of permissions for a given role.
 *
 * @param role - The role name to get permissions for
 * @returns A Set containing all permissions for the role
 *
 * @example
 * ```typescript
 * const perms = getPermissionsForRole('SELLER');
 * perms.has('canViewDashboard'); // true
 * perms.has('canManageProducts'); // false
 * ```
 */
export function getPermissionsForRole(role: RoleName): ReadonlySet<PermissionKey> {
  const permissions = ROLE_PERMISSIONS_MAP[role];

  if (!permissions) {
    return new Set<PermissionKey>();
  }

  return new Set<PermissionKey>(permissions);
}

/**
 * Checks if a role has a specific permission.
 *
 * @param role - The role name to check
 * @param permission - The permission to verify
 * @returns true if the role has the permission, false otherwise
 *
 * @example
 * ```typescript
 * hasPermission('ADMIN', 'canManageTeam'); // true
 * hasPermission('SELLER', 'canManageTeam'); // false
 * ```
 */
export function hasPermission(role: RoleName, permission: PermissionKey): boolean {
  const permissions = ROLE_PERMISSIONS_MAP[role];

  if (!permissions) {
    return false;
  }

  return (permissions as readonly PermissionKey[]).includes(permission);
}

/**
 * Checks if a role has ANY of the specified permissions (OR logic).
 *
 * @param role - The role name to check
 * @param permissions - Array of permissions to check against
 * @returns true if the role has at least one of the permissions
 *
 * @example
 * ```typescript
 * hasAnyPermission('SELLER', ['canManageTeam', 'canViewDashboard']); // true
 * hasAnyPermission('SELLER', ['canManageTeam', 'canManageSettings']); // false
 * ```
 */
export function hasAnyPermission(
  role: RoleName,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/**
 * Checks if a role has ALL of the specified permissions (AND logic).
 *
 * @param role - The role name to check
 * @param permissions - Array of permissions to check against
 * @returns true if the role has all of the permissions
 *
 * @example
 * ```typescript
 * hasAllPermissions('ADMIN', ['canViewDashboard', 'canManageTeam']); // true
 * hasAllPermissions('SELLER', ['canViewDashboard', 'canManageTeam']); // false
 * ```
 */
export function hasAllPermissions(
  role: RoleName,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}
