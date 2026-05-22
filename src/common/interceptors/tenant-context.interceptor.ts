import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from '@/common/context/tenant.context';

/**
 * Interceptor que establece el tenantId en AsyncLocalStorage para que la
 * extensión de Prisma pueda inyectar where.tenantId/organizationId.
 * Debe ejecutarse después de OrganizationGuard (que pone request.activeOrganizationId).
 * Si no hay organización activa, no se establece contexto (rutas públicas, login, etc.).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const organizationId = request.activeOrganizationId as number | undefined;

    if (organizationId == null) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      const inner$ = TenantContext.run(organizationId, () => next.handle());
      return inner$.subscribe({
        next: (v) => subscriber.next(v),
        error: (e) => subscriber.error(e),
        complete: () => subscriber.complete(),
      });
    });
  }
}
