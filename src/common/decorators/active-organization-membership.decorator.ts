import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Member } from '@prisma/client';

/**
 * Decorador para obtener la membresía activa del usuario en la organización desde el request
 * Requiere que OrganizationGuard esté aplicado en la ruta
 *
 * @example
 * ```typescript
 * @Get()
 * @UseGuards(JwtAuthGuard, OrganizationGuard)
 * findAll(@ActiveOrganizationMembership() membership: Member) {
 *   // membership contiene la información de la membresía (rol, status, etc.)
 *   const userRole = membership.role; // OWNER, ADMIN, SELLER, WAREHOUSE
 * }
 * ```
 */
export const ActiveOrganizationMembership = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Member => {
    const request = ctx.switchToHttp().getRequest();
    return request.activeOrganizationMembership;
  },
);
