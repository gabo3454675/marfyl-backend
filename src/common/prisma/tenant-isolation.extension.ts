import { Prisma } from '@prisma/client';
import { TenantContext } from '@/common/context/tenant.context';

/**
 * Modelos que tienen tenantId (campo literal "tenantId" en el schema).
 */
const MODELS_WITH_TENANT_ID = new Set<string>(['InventoryMovement', 'VehicleInspection', 'CierreCaja', 'Pago']);

/**
 * Modelos que tienen organizationId (campo literal "organizationId" en el schema).
 */
const MODELS_WITH_ORGANIZATION_ID = new Set<string>([
  'Product',
  'Customer',
  'Invoice',
  'Supplier',
  'ExpenseCategory',
  'Expense',
  'Document',
  'Task',
  'CustomerCredit',
  'Invitation',
  'Member',
  'AuditLog',
  'TasaHistorica',
  'ActivityLog',
  'ExpensePayment',
]);

function getTenantFieldForModel(model: string): 'tenantId' | 'organizationId' | null {
  if (MODELS_WITH_TENANT_ID.has(model)) return 'tenantId';
  if (MODELS_WITH_ORGANIZATION_ID.has(model)) return 'organizationId';
  return null;
}

function mergeWhere(where: Record<string, unknown> | undefined, field: string, value: number): Record<string, unknown> {
  const base = (where ?? {}) as Record<string, unknown>;
  return { ...base, [field]: value };
}

/**
 * Extensión de Prisma que inyecta automáticamente el filtro de tenant/organización
 * en todas las consultas cuando hay un contexto activo (establecido por OrganizationGuard).
 * Garantiza aislamiento de datos entre empresas.
 */
export const tenantIsolationExtension = Prisma.defineExtension((prisma) =>
  prisma.$extends({
    name: 'tenantIsolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const tenantId = TenantContext.getTenantId();
          if (tenantId === undefined) return query(args);

          const field = model ? getTenantFieldForModel(model) : null;
          if (!field) return query(args);

          const argsCopy = { ...args } as Record<string, unknown>;

          switch (operation) {
            case 'findUnique':
            case 'findFirst':
            case 'findMany':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              if (argsCopy.where && typeof argsCopy.where === 'object') {
                argsCopy.where = mergeWhere(argsCopy.where as Record<string, unknown>, field, tenantId);
              } else {
                argsCopy.where = { [field]: tenantId };
              }
              break;
            case 'create':
              if (argsCopy.data && typeof argsCopy.data === 'object') {
                (argsCopy.data as Record<string, unknown>)[field] = tenantId;
              }
              break;
            case 'createMany':
              if (argsCopy.data !== undefined) {
                const data = Array.isArray(argsCopy.data) ? argsCopy.data : [argsCopy.data];
                (argsCopy as any).data = data.map((row: Record<string, unknown>) => ({
                  ...row,
                  [field]: tenantId,
                }));
              }
              break;
            case 'update':
            case 'updateMany':
            case 'delete':
            case 'deleteMany':
              if (argsCopy.where && typeof argsCopy.where === 'object') {
                argsCopy.where = mergeWhere(argsCopy.where as Record<string, unknown>, field, tenantId);
              } else {
                argsCopy.where = { [field]: tenantId };
              }
              break;
            case 'upsert':
              if (argsCopy.where && typeof argsCopy.where === 'object') {
                argsCopy.where = mergeWhere(argsCopy.where as Record<string, unknown>, field, tenantId);
              }
              if (argsCopy.create && typeof argsCopy.create === 'object') {
                (argsCopy.create as Record<string, unknown>)[field] = tenantId;
              }
              if (argsCopy.update && typeof argsCopy.update === 'object') {
                (argsCopy.update as Record<string, unknown>)[field] = tenantId;
              }
              break;
            default:
              break;
          }

          return query(argsCopy);
        },
      },
    },
  }),
);

