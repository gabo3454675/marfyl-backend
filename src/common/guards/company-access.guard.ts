import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

/** Nombre de la organización a la que se restringe el acceso a inspección de vehículos. */
const ALLOWED_ORGANIZATION_NAME = 'Davean';

/**
 * Guard que restringe el acceso a inspección de vehículos a la organización 'Davean'.
 * Debe usarse junto con JwtAuthGuard y OrganizationGuard (para tener activeOrganizationId).
 * Solo permite el acceso si la organización activa (x-tenant-id) es la de nombre 'Davean'.
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const organizationId = request.activeOrganizationId as number | undefined;

    if (organizationId == null) {
      throw new ForbiddenException(
        'Se requiere organización activa en el token. Use OrganizationGuard antes de CompanyAccessGuard.',
      );
    }

    const davean = await this.prisma.organization.findFirst({
      where: { nombre: ALLOWED_ORGANIZATION_NAME },
      select: { id: true },
    });

    if (!davean) {
      throw new ForbiddenException(
        `El módulo de inspección de vehículos no está disponible para esta organización.`,
      );
    }

    if (organizationId !== davean.id) {
      throw new ForbiddenException(
        'El acceso a inspección de vehículos está restringido a la empresa autorizada.',
      );
    }

    return true;
  }
}
