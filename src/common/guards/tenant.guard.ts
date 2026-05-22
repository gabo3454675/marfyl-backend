import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const companyId = request.headers['x-tenant-id'] || request.headers['x-company-id'];

    if (!companyId) {
      throw new BadRequestException('Header x-tenant-id es requerido');
    }

    const companyIdNum = parseInt(companyId, 10);
    if (isNaN(companyIdNum)) {
      throw new BadRequestException('x-tenant-id debe ser un número válido');
    }

    // Verificar que el usuario pertenece a esta empresa
    const membership = await this.prisma.companyMember.findFirst({
      where: {
        userId: user.id,
        companyId: companyIdNum,
        status: 'ACTIVE',
      },
      include: {
        company: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException(
        'No tienes acceso a esta empresa o la membresía está inactiva',
      );
    }

    // Inyectar información en el request
    request.activeCompanyId = companyIdNum;
    request.activeCompany = membership.company;
    request.activeMembership = membership;

    return true;
  }
}
