/**
 * Permission constants for the MARFYL application.
 *
 * Station model (piso):
 * - canTakeFloorOrder  → anfitrión (WAITER)
 * - canViewKitchenQueue → cocina/barra (KITCHEN)
 * - canAccessPOS       → caja cobra comandas listas
 * - canAccessComanda   → legado / acceso genérico a módulo comanda
 */

export type PermissionKey =
  | 'canViewDashboard'
  | 'canViewFinancialCharts'
  | 'canViewReports'
  | 'canAccessPOS'
  | 'canAccessComanda'
  | 'canTakeFloorOrder'
  | 'canViewKitchenQueue'
  | 'canViewFloorHistory'
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

export const ALL_PERMISSIONS: readonly PermissionKey[] = [
  'canViewDashboard',
  'canViewFinancialCharts',
  'canViewReports',
  'canAccessPOS',
  'canAccessComanda',
  'canTakeFloorOrder',
  'canViewKitchenQueue',
  'canViewFloorHistory',
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

export type RoleName =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'MANAGER'
  | 'SELLER'
  | 'WAREHOUSE'
  | 'POS_OPERATOR'
  | 'WAITER'
  | 'KITCHEN'
  | 'FISCAL';

const FULL_OPS = [
  'canViewDashboard',
  'canViewFinancialCharts',
  'canViewReports',
  'canAccessPOS',
  'canAccessComanda',
  'canTakeFloorOrder',
  'canViewKitchenQueue',
  'canViewFloorHistory',
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
] as const satisfies readonly PermissionKey[];

export const ROLE_PERMISSIONS_MAP = {
  SUPER_ADMIN: FULL_OPS,

  ADMIN: [
    'canViewDashboard',
    'canViewFinancialCharts',
    'canViewReports',
    'canAccessPOS',
    'canAccessComanda',
    'canTakeFloorOrder',
    'canViewKitchenQueue',
    'canViewFloorHistory',
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
    'canAccessPOS',
    'canAccessComanda',
    'canTakeFloorOrder',
    'canViewKitchenQueue',
    'canViewFloorHistory',
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

  /** Cajero / vendedor: solo cobro (POS), sin tomar pedido ni cocina */
  SELLER: [
    'canViewDashboard',
    'canAccessPOS',
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

  /** Cajero dedicado */
  POS_OPERATOR: [
    'canAccessPOS',
    'canViewProducts',
    'canManageCierreCaja',
  ] as const,

  /** Anfitrión: toma pedidos + ve su historial */
  WAITER: [
    'canAccessComanda',
    'canTakeFloorOrder',
    'canViewFloorHistory',
    'canViewProducts',
  ] as const,

  /** Cocina / barra: solo cola KDS */
  KITCHEN: [
    'canAccessComanda',
    'canViewKitchenQueue',
    'canViewProducts',
  ] as const,

  FISCAL: [
    'canViewDashboard',
    'canManageFiscal',
  ] as const,
} as const;

export function getPermissionsForRole(role: RoleName): ReadonlySet<PermissionKey> {
  const permissions = ROLE_PERMISSIONS_MAP[role];
  if (!permissions) {
    return new Set<PermissionKey>();
  }
  return new Set<PermissionKey>(permissions);
}

export function hasPermission(role: RoleName, permission: PermissionKey): boolean {
  const permissions = ROLE_PERMISSIONS_MAP[role];
  if (!permissions) {
    return false;
  }
  return (permissions as readonly PermissionKey[]).includes(permission);
}

export function hasAnyPermission(
  role: RoleName,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

export function hasAllPermissions(
  role: RoleName,
  permissions: readonly PermissionKey[],
): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}
