import { ExecutionContext, Injectable, Inject } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Reflector } from "@nestjs/core";
import { CacheInterceptor } from "@nestjs/cache-manager";

/**
 * Interceptor de caché que incluye x-tenant-id en la clave.
 * Evita que al cambiar de organización (Super Admin o usuario multi-org) se devuelva
 * la respuesta cacheada de otra org (ej. datos de Monddy al seleccionar Davean).
 */
@Injectable()
export class HttpCacheTenantInterceptor extends CacheInterceptor {
  constructor(@Inject(CACHE_MANAGER) cacheManager: any, reflector: Reflector) {
    super(cacheManager, reflector);
  }

  protected trackBy(context: ExecutionContext): string | undefined {
    const request = context.switchToHttp().getRequest();
    if (!this.isRequestCacheable(context)) {
      return undefined;
    }
    const httpAdapter = this.httpAdapterHost?.httpAdapter;
    if (!httpAdapter || typeof httpAdapter.getRequestUrl !== "function") {
      return undefined;
    }
    const baseUrl = httpAdapter.getRequestUrl(request);
    const tenantId =
      request.activeOrganizationId ??
      request.headers["x-organization-id"] ??
      request.headers["x-tenant-id"];
    if (
      tenantId !== undefined &&
      tenantId !== null &&
      String(tenantId).trim() !== ""
    ) {
      return `${baseUrl}:tenant:${tenantId}`;
    }
    // Sin tenant no cachear: evita servir respuesta de otra org.
    return undefined;
  }
}
