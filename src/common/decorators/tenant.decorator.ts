import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Obtiene el tenantId desde el JWT (organización activa). No se usa el header del frontend. */
export const TenantId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const id = request.user?.organizationId ?? request.user?.tenantId;
    return id != null ? String(id) : undefined;
  }
);
