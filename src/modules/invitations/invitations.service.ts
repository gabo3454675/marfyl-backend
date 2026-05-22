import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { getPermissions, ROLES } from '@/common/constants/roles.constants';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ProvisionMemberDto } from './dto/provision-member.dto';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class InvitationsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Invita a un miembro a una organización
   * Maneja tanto usuarios nuevos como existentes
   */
  async inviteMember(
    inviteDto: InviteMemberDto,
    organizationId: number,
    invitedBy: number,
  ) {
    // Validar que el invitador tiene permisos (SUPER_ADMIN o ADMIN)
    let inviterMembership = await this.prisma.member.findFirst({
      where: {
        userId: invitedBy,
        organizationId: organizationId,
        status: 'ACTIVE',
      },
    });

    // Super Admin del sistema puede invitar en cualquier org aunque no sea miembro
    let inviterRole: string;
    if (inviterMembership) {
      inviterRole = String(inviterMembership.role).toUpperCase();
    } else {
      const inviterUser = await this.prisma.user.findUnique({
        where: { id: invitedBy },
        select: { isSuperAdmin: true },
      });
      if (inviterUser?.isSuperAdmin) {
        inviterRole = ROLES.SUPER_ADMIN;
      } else {
        throw new ForbiddenException(
          'No tienes acceso a esta organización',
        );
      }
    }
    const perms = getPermissions(inviterRole);
    if (!perms.canManageUsers) {
      throw new ForbiddenException(
        'Solo los SUPER_ADMIN y ADMIN pueden invitar miembros',
      );
    }

    // REGLA: Los ADMIN no pueden crear otros ADMIN ni SUPER_ADMIN
    if (inviterRole === ROLES.ADMIN && String(inviteDto.role).toUpperCase() === ROLES.ADMIN) {
      throw new ForbiddenException(
        'Los ADMIN no pueden crear otros ADMIN. Solo el SUPER_ADMIN puede asignar roles ADMIN.',
      );
    }
    if (inviterRole === ROLES.ADMIN && String(inviteDto.role).toUpperCase() === ROLES.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Los ADMIN no pueden crear SUPER_ADMIN. Solo el SUPER_ADMIN del sistema puede asignar este rol.',
      );
    }

    // Verificar si el usuario existe
    const existingUser = await this.prisma.user.findUnique({
      where: { email: inviteDto.email },
    });

    // Verificar que no existe una membresía activa (solo si el usuario existe)
    let existingMembership = null;
    if (existingUser) {
      existingMembership = await this.prisma.member.findFirst({
        where: {
          userId: existingUser.id,
          organizationId: organizationId,
          status: 'ACTIVE',
        },
      });
    }

    if (existingMembership) {
      throw new ConflictException(
        'Este usuario ya es miembro activo de esta organización',
      );
    }

    // Verificar si existe una invitación pendiente para este email y organización
    const existingInvitation = await this.prisma.invitation.findFirst({
      where: {
        email: inviteDto.email,
        organizationId: organizationId,
        status: 'PENDING',
        expiresAt: {
          gt: new Date(),
        },
      },
    });

    if (existingInvitation) {
      throw new ConflictException(
        'Ya existe una invitación pendiente para este usuario',
      );
    }

    // Generar token único
    const token = randomBytes(32).toString('hex');

    // Fecha de expiración: 7 días desde ahora
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Crear la invitación (funciona tanto para usuarios nuevos como existentes)
    const invitation = await this.prisma.invitation.create({
      data: {
        email: inviteDto.email,
        token,
        role: inviteDto.role,
        organizationId: organizationId,
        invitedBy: invitedBy,
        expiresAt,
        status: 'PENDING',
      },
      include: {
        organization: {
          select: {
            id: true,
            nombre: true,
            slug: true,
          },
        },
        inviter: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
    });

    // TODO: Enviar email con el token de invitación
    // Por ahora retornamos el token para desarrollo
    return {
      invitation,
      token, // En producción, esto se enviaría por email
      invitationUrl: `/accept-invitation?token=${token}`,
    };
  }

  /**
   * Provisionamiento interno: crea usuario y/o lo agrega a la organización sin enviar email.
   * - Usuario nuevo: crea User con contraseña temporal, crea Member. Retorna { isNewUser: true, tempPassword }.
   * - Usuario existente: solo crea Member. Retorna { isNewUser: false, message }.
   * Rollback: si falla la inserción en la organización tras crear el usuario, se revierte la creación del usuario.
   */
  async provisionMember(
    dto: ProvisionMemberDto,
    organizationId: number,
    invitedBy: number,
  ) {
    let inviterMembership = await this.prisma.member.findFirst({
      where: {
        userId: invitedBy,
        organizationId,
        status: 'ACTIVE',
      },
    });

    let inviterRole: string;
    if (inviterMembership) {
      inviterRole = String(inviterMembership.role).toUpperCase();
    } else {
      const inviterUser = await this.prisma.user.findUnique({
        where: { id: invitedBy },
        select: { isSuperAdmin: true },
      });
      if (inviterUser?.isSuperAdmin) {
        inviterRole = ROLES.SUPER_ADMIN;
      } else {
        throw new ForbiddenException('No tienes acceso a esta organización');
      }
    }

    const perms = getPermissions(inviterRole);
    if (!perms.canManageUsers) {
      throw new ForbiddenException(
        'Solo SUPER_ADMIN y ADMIN pueden agregar miembros directamente',
      );
    }

    const targetRole = String(dto.role).toUpperCase();
    if (inviterRole === ROLES.ADMIN && targetRole === ROLES.ADMIN) {
      throw new ForbiddenException(
        'Los ADMIN no pueden crear otros ADMIN. Solo el SUPER_ADMIN puede asignar roles ADMIN.',
      );
    }
    if (inviterRole === ROLES.ADMIN && targetRole === ROLES.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Los ADMIN no pueden crear SUPER_ADMIN. Solo el SUPER_ADMIN puede asignar este rol.',
      );
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existingUser) {
      const existingMembership = await this.prisma.member.findFirst({
        where: {
          userId: existingUser.id,
          organizationId,
          status: 'ACTIVE',
        },
      });
      if (existingMembership) {
        throw new ConflictException(
          'Este usuario ya es miembro activo de esta organización',
        );
      }
      try {
        const member = await this.prisma.member.create({
          data: {
            userId: existingUser.id,
            organizationId,
            role: dto.role,
            status: 'ACTIVE',
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        });
        return {
          isNewUser: false,
          message: 'Usuario agregado a la organización',
          member: this.mapMemberToResponse(member),
        };
      } catch (e: any) {
        // Unique constraint: membresía ya existe (race condition), buscar y devolver
        if (e?.code === 'P2002') {
          const existing = await this.prisma.member.findFirst({
            where: { userId: existingUser.id, organizationId, status: 'ACTIVE' },
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  avatarUrl: true,
                },
              },
            },
          });
          if (existing) {
            return {
              isNewUser: false,
              message: 'Usuario agregado a la organización',
              member: this.mapMemberToResponse(existing),
            };
          }
        }
        throw e;
      }
    }

    // Usuario nuevo: crear User + Member en transacción
    const tempPassword = dto.tempPassword ?? this.generateTempPassword();
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(tempPassword, saltRounds);
    const email = dto.email.toLowerCase().trim();
    const fullName = dto.fullName?.trim() || null;

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          fullName,
          requiresPasswordChange: true, // Clave temporal, debe cambiarla al primer login
        },
      });
      const member = await tx.member.create({
        data: {
          userId: user.id,
          organizationId,
          role: dto.role,
          status: 'ACTIVE',
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              fullName: true,
              avatarUrl: true,
            },
          },
        },
      });
      return { user, member };
    });

    return {
      isNewUser: true,
      tempPassword,
      member: this.mapMemberToResponse(result.member),
    };
  }

  private generateTempPassword(): string {
    return 'Disis2026!';
  }

  private mapMemberToResponse(member: {
    id: number;
    userId: number;
    role: string;
    status: string;
    joinedAt: Date;
    user: { id: number; email: string; fullName: string | null; avatarUrl: string | null };
  }) {
    return {
      id: member.id,
      userId: member.userId,
      email: member.user.email,
      fullName: member.user.fullName,
      avatarUrl: member.user.avatarUrl,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
    };
  }

  /**
   * Acepta una invitación
   * Si el usuario existe, lo vincula a la organización
   * Si no existe, debería crear el usuario (pero eso se manejaría en otro endpoint)
   */
  async acceptInvitation(token: string, userId: number) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        organization: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitación no encontrada');
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Esta invitación ya fue procesada');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Esta invitación ha expirado');
    }

    // Verificar que el email del usuario coincide con el de la invitación
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.email !== invitation.email) {
      throw new ForbiddenException(
        'El email del usuario no coincide con el de la invitación',
      );
    }

    // Verificar que no existe ya una membresía activa
    const existingMembership = await this.prisma.member.findFirst({
      where: {
        userId: userId,
        organizationId: invitation.organizationId,
        status: 'ACTIVE',
      },
    });

    if (existingMembership) {
      // Marcar invitación como aceptada aunque ya exista membresía
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });
      throw new ConflictException(
        'Ya eres miembro de esta organización',
      );
    }

    // Crear la membresía
    const membership = await this.prisma.member.create({
      data: {
        userId: userId,
        organizationId: invitation.organizationId,
        role: invitation.role,
        status: 'ACTIVE',
      },
      include: {
        organization: true,
      },
    });

    // Marcar invitación como aceptada
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED' },
    });

    return membership;
  }

  /**
   * Obtiene todos los miembros activos de una organización
   */
  async getOrganizationMembers(organizationId: number) {
    const members = await this.prisma.member.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    }));
  }

  /**
   * Obtiene todas las invitaciones de una organización
   */
  async getOrganizationInvitations(organizationId: number, userId: number) {
    const membership = await this.prisma.member.findFirst({
      where: {
        userId: userId,
        organizationId: organizationId,
        status: 'ACTIVE',
      },
    });

    const role = membership
      ? String(membership.role).toUpperCase()
      : (await this.prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true } }))?.isSuperAdmin
        ? ROLES.SUPER_ADMIN
        : null;
    if (!role || !getPermissions(role).canManageUsers) {
      throw new ForbiddenException(
        'Solo los SUPER_ADMIN y ADMIN pueden ver las invitaciones',
      );
    }

    return this.prisma.invitation.findMany({
      where: {
        organizationId: organizationId,
      },
      include: {
        inviter: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
