import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildDevPreviewUser, isDevPreviewAuthEnabled } from '../dev-preview';

@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Validar que el usuario esté autenticado
    if (!user) {
      throw new ForbiddenException('Usuario no autenticado');
    }

    const previewUser = buildDevPreviewUser();
    if (isDevPreviewAuthEnabled() && user.id === previewUser.id) {
      const organizationId = user.organizationId ?? user.tenantId ?? previewUser.organizationId;
      request.activeOrganizationId = organizationId;
      request.activeOrganization = {
        id: organizationId,
        name: 'Demo MARFYL (vista previa)',
        nombre: 'Demo MARFYL (vista previa)',
      };
      request.activeOrganizationMembership = {
        id: 0,
        userId: user.id,
        organizationId,
        role: 'ADMIN',
        status: 'ACTIVE',
        organization: request.activeOrganization,
      };
      return true;
    }

    // TenantId SOLO desde el JWT; no se confía en el ID enviado por el frontend (headers/body).
    const organizationId = user.organizationId ?? user.tenantId;

    if (organizationId == null) {
      throw new BadRequestException(
        'No hay organización activa en la sesión. Use POST /auth/switch-organization o inicie sesión de nuevo.',
      );
    }

    if (
      isDevPreviewAuthEnabled() &&
      user.id === previewUser.id &&
      user.isSuperAdmin === true &&
      organizationId === previewUser.organizationId &&
      !this.prisma.dbAvailable
    ) {
      request.activeOrganizationId = organizationId;
      request.activeOrganization = {
        id: organizationId,
        name: 'Demo MARFYL (sin BD)',
        nombre: 'Demo MARFYL (sin BD)',
      };
      request.activeOrganizationMembership = {
        id: 0,
        userId: user.id,
        organizationId,
        role: 'ADMIN',
        status: 'ACTIVE',
        organization: request.activeOrganization,
      };
      return true;
    }

    // Verificar que la organización existe
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException(
        `La organización con ID ${organizationId} no existe`,
      );
    }

    // Verificar que el usuario es miembro activo de esta organización
    let membership = await this.prisma.member.findFirst({
      where: {
        userId: user.id,
        organizationId: organizationId,
        status: 'ACTIVE',
      },
      include: {
        organization: true,
      },
    });

    // Super Admin puede acceder a cualquier organización aunque no sea miembro
    if (!membership) {
      const dbUser = await this.prisma.user.findUnique({
        where: { id: user.id },
        select: { isSuperAdmin: true },
      });
      if (user.isSuperAdmin === true || dbUser?.isSuperAdmin) {
        membership = {
          id: 0,
          userId: user.id,
          organizationId,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          joinedAt: new Date(),
          organization,
        } as any;
      } else {
        throw new ForbiddenException(
          'No tienes acceso a esta organización o tu membresía está inactiva',
        );
      }
    }

    // Inyectar información en el request para uso en controladores
    request.activeOrganizationId = organizationId;
    request.activeOrganization = membership.organization;
    request.activeOrganizationMembership = membership;

    return true;
  }
}
