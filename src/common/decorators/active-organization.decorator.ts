import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorador para obtener el ID de la organización activa desde el request
 * Requiere que OrganizationGuard esté aplicado en la ruta
 *
 * @example
 * ```typescript
 * @Get()
 * @UseGuards(JwtAuthGuard, OrganizationGuard)
 * findAll(@ActiveOrganization() organizationId: number) {
 *   // organizationId contiene el ID de la organización
 * }
 * ```
 */
export const ActiveOrganization = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest();
    return request.activeOrganizationId;
  },
);
