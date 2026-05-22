import { AsyncLocalStorage } from 'async_hooks';

/**
 * Contexto de tenant por request. Permite que la extensión de Prisma
 * inyecte automáticamente where.tenantId/organizationId sin recibir
 * el request en la capa de datos.
 * Se establece en OrganizationGuard y se lee en la extensión de Prisma.
 */
const tenantStorage = new AsyncLocalStorage<number>();

export const TenantContext = {
  /**
   * Ejecuta una función con el tenantId establecido en el contexto.
   * Usado por OrganizationGuard para envolver el resto del pipeline.
   */
  run<T>(tenantId: number, fn: () => T): T {
    return tenantStorage.run(tenantId, fn);
  },

  /**
   * Obtiene el tenantId del contexto actual (organización activa).
   * Devuelve undefined si no hay contexto (ej. rutas públicas).
   */
  getTenantId(): number | undefined {
    return tenantStorage.getStore();
  },
};
