import { ExecutionContext, Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Reflector } from '@nestjs/core';
import { CacheInterceptor } from '@nestjs/cache-manager';

/**
 * Interceptor de caché que incluye x-tenant-id en la clave.
 * Evita que al cambiar de organización (Super Admin o usuario multi-org) se devuelva
 * la respuesta cacheada de otra org (ej. datos de Monddy al seleccionar Davean).
 */
@Injectable()
export class HttpCacheTenantInterceptor extends CacheInterceptor {
  constructor(
    @Inject(CACHE_MANAGER) cacheManager: any,
    reflector: Reflector,
  ) {
    super(cacheManager, reflector);
  }

  protected trackBy(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest();
    if (!this.isRequestCacheable(context)) {
      return undefined;
    }
    const httpAdapter = this.httpAdapterHost?.httpAdapter;
    if (!httpAdapter || typeof httpAdapter.getRequestUrl !== 'function') {
      return undefined;
    }
    let baseUrl = httpAdapter.getRequestUrl(request);
    if (typeof baseUrl === 'string' && baseUrl.includes('/tenants/organization') && !baseUrl.includes('organizations-all')) {
      return undefined;
    }
    const tenantId =
      request.headers['x-tenant-id'] ?? request.activeOrganizationId;
    if (tenantId !== undefined && tenantId !== null && String(tenantId).trim() !== '') {
      return `${baseUrl}:tenant:${tenantId}`;
    }
    return baseUrl;
  }
}
