/**
 * Formato estándar de respuesta paginada para todos los endpoints del backend.
 * Patrón ya existente parcialmente en tenants.service.ts
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
