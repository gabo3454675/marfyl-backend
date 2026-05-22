import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Organization } from '@prisma/client';

/**
 * Decorador para obtener el objeto completo de la organización activa desde el request
 * Requiere que OrganizationGuard esté aplicado en la ruta
 *
 * @example
 * ```typescript
 * @Get()
 * @UseGuards(JwtAuthGuard, OrganizationGuard)
 * findAll(@ActiveOrganizationObject() organization: Organization) {
 *   // organization contiene el objeto completo de la organización
 * }
 * ```
 */
export const ActiveOrganizationObject = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Organization => {
    const request = ctx.switchToHttp().getRequest();
    return request.activeOrganization;
  },
);
