import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import {
  ROLE_ORDER,
  getPermissions,
  canDeleteSuperAdmin,
  ROLES,
} from '@/common/constants/roles.constants';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { Role } from '@prisma/client';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Devuelve todas las organizaciones. Solo para Super Admin.
   * Usado en el switcher cuando el usuario es Super Admin para poder cambiar entre cualquier org.
   */
  async getAllOrganizationsForSuperAdmin(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException(
        'Solo un Super Admin puede listar todas las organizaciones',
      );
    }
    const orgs = await this.prisma.organization.findMany({
      orderBy: { nombre: 'asc' },
      select: {
        id: true,
        nombre: true,
        slug: true,
        plan: true,
        currencyCode: true,
        currencySymbol: true,
        exchangeRate: true,
        rateUpdatedAt: true,
      },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.nombre,
      slug: o.slug,
      plan: o.plan,
      currencyCode: o.currencyCode ?? 'USD',
      currencySymbol: o.currencySymbol ?? '$',
      exchangeRate: o.exchangeRate ?? 1,
      rateUpdatedAt: o.rateUpdatedAt ?? null,
    }));
  }

  /**
   * Obtiene los datos de la organización actual (incluye exchangeRate y quién actualizó la tasa).
   * La tasa es única por organización: todos los usuarios ven la misma y se sincroniza desde aquí.
   */
  async getOrganization(organizationId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        nombre: true,
        slug: true,
        plan: true,
        currencyCode: true,
        currencySymbol: true,
        exchangeRate: true,
        rateUpdatedAt: true,
      },
    });
    if (!org) {
      throw new NotFoundException('Organización no encontrada');
    }
    const lastRateUpdate = await this.prisma.auditLog.findFirst({
      where: { organizationId, action: 'EXCHANGE_RATE_UPDATE' },
      orderBy: { createdAt: 'desc' },
      select: { actorEmail: true },
    });
    return {
      id: org.id,
      name: org.nombre,
      slug: org.slug,
      plan: org.plan,
      currencyCode: org.currencyCode ?? 'USD',
      currencySymbol: org.currencySymbol ?? '$',
      exchangeRate: org.exchangeRate ?? 1,
      rateUpdatedAt: org.rateUpdatedAt ?? null,
      rateUpdatedBy: lastRateUpdate?.actorEmail ?? null,
    };
  }

  /**
   * Actualiza la organización (p. ej. tasa de cambio). Solo ADMIN/SUPER_ADMIN.
   * Registra en audit log quién cambió la tasa.
   */
  async updateOrganization(
    organizationId: number,
    dto: UpdateOrganizationDto,
    actorUserId: number,
  ) {
    const data: { exchangeRate?: number; rateUpdatedAt?: Date; currencyCode?: string; currencySymbol?: string } = {};
    if (dto.exchangeRate !== undefined) {
      data.exchangeRate = dto.exchangeRate;
      data.rateUpdatedAt = new Date();
    }
    if (dto.currencyCode !== undefined) data.currencyCode = dto.currencyCode;
    if (dto.currencySymbol !== undefined) data.currencySymbol = dto.currencySymbol;
    if (Object.keys(data).length === 0) {
      return this.getOrganization(organizationId);
    }

    const orgBefore = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true },
    });
    const oldRate = orgBefore?.exchangeRate ?? null;

    await this.prisma.organization.update({
      where: { id: organizationId },
      data,
    });

    if (dto.exchangeRate !== undefined) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { email: true },
      });
      await this.prisma.auditLog.create({
        data: {
          organizationId,
          userId: actorUserId,
          action: 'EXCHANGE_RATE_UPDATE',
          entityType: 'organization',
          entityId: String(organizationId),
          oldValue: oldRate != null ? { exchangeRate: oldRate } : undefined,
          newValue: { exchangeRate: dto.exchangeRate },
          actorEmail: actor?.email ?? undefined,
          targetSummary: `Tasa BCV: ${oldRate ?? '—'} → ${dto.exchangeRate}`,
        },
      });
    }

    return this.getOrganization(organizationId);
  }

  async findOne(id: string) {
    // TODO: Implementar búsqueda de tenant
    return null;
  }

  /**
   * Alias de compatibilidad: algunos clientes llaman "findAll" para listar miembros.
   */
  async findAll(organizationId: number) {
    return this.getMembers(organizationId);
  }

  /**
   * Obtiene miembros de la organización según visibilidad del rol del solicitante.
   * - SUPER_ADMIN / ADMIN: lista completa.
   * - MANAGER: solo su equipo (SELLER, WAREHOUSE).
   * - SELLER / WAREHOUSE: no pueden ver la lista (devolver vacío; el guard puede bloquear acceso).
   */
  async getMembers(organizationId: number, requesterRole?: string) {
    const role = String(requesterRole || '').toUpperCase().trim();

    const members = await this.prisma.member.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        user: { isActive: true },
        ...(role === ROLES.MANAGER
          ? { role: { in: ['SELLER', 'WAREHOUSE'] } }
          : {}),
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

    // SELLER / WAREHOUSE: no ven a nadie (lista vacía)
    if (role === ROLES.SELLER || role === ROLES.WAREHOUSE) {
      return [];
    }

    const mapped = members.map((m) => ({
      id: m.id,
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      avatarUrl: m.user.avatarUrl,
      role: m.role,
      status: m.status,
      joinedAt: m.joinedAt,
    }));

    const roleWeight = (r: string) => ROLE_ORDER[String(r).toUpperCase()] ?? 0;

    mapped.sort((a, b) => {
      const diff = roleWeight(b.role) - roleWeight(a.role);
      if (diff !== 0) return diff;
      return new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime();
    });

    return mapped;
  }

  /**
   * Actualiza el rol de un miembro.
   * - Un ADMIN no puede cambiar el rol de un SUPER_ADMIN (OWNER).
   * - Un ADMIN no puede promoverse a sí mismo a SUPER_ADMIN.
   */
  async updateMemberRole(
    memberId: number,
    organizationId: number,
    dto: UpdateMemberRoleDto,
    requesterUserId: number,
    requesterRole: string,
  ) {
    const membership = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId, status: 'ACTIVE' },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });

    if (!membership) {
      throw new NotFoundException('Miembro no encontrado en esta organización');
    }

    const role = String(requesterRole).toUpperCase().trim();
    const newRole = String(dto.newRole).toUpperCase().trim() as Role;
    const perms = getPermissions(role);

    if (!perms.canManageUsers) {
      throw new ForbiddenException('Solo un administrador puede cambiar roles');
    }

    if (String(membership.role).toUpperCase() === ROLES.SUPER_ADMIN && role !== ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('No puedes cambiar el rol del propietario (SUPER_ADMIN)');
    }

    if (membership.userId === requesterUserId && newRole === ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('No puedes promoverse a ti mismo a propietario');
    }

    const oldRole = String(membership.role).toUpperCase();
    const updated = await this.prisma.member.update({
      where: { id: memberId },
      data: { role: newRole as Role },
      include: {
        user: { select: { id: true, email: true, fullName: true, avatarUrl: true } },
      },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { email: true },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        userId: requesterUserId,
        action: 'MEMBER_ROLE_CHANGE',
        entityType: 'member',
        entityId: String(memberId),
        oldValue: { role: oldRole },
        newValue: { role: newRole },
        actorEmail: actor?.email ?? undefined,
        targetSummary: `${membership.user.fullName || membership.user.email}: ${oldRole} → ${newRole}`,
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      email: updated.user.email,
      fullName: updated.user.fullName,
      avatarUrl: updated.user.avatarUrl,
      role: updated.role,
      status: updated.status,
      joinedAt: updated.joinedAt,
    };
  }

  /**
   * Desactiva un miembro (soft delete: status = SUSPENDED).
   * NO borra el User ni el historial (facturas, tareas siguen vinculadas al User).
   */
  async removeMemberByMemberId(
    memberId: number,
    organizationId: number,
    requesterUserId: number,
    requesterRole: string,
  ) {
    const membership = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId },
      include: { user: { select: { id: true, email: true, fullName: true } } },
    });

    if (!membership) {
      throw new NotFoundException('Miembro no encontrado en esta organización');
    }

    if (membership.userId === requesterUserId) {
      throw new BadRequestException('No puedes desactivarte a ti mismo');
    }

    const role = String(requesterRole).toUpperCase().trim();
    const perms = getPermissions(role);
    if (!perms.canManageUsers) {
      throw new ForbiddenException('Solo un administrador puede desactivar miembros');
    }
    if (!canDeleteSuperAdmin(role) && String(membership.role).toUpperCase() === ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Un ADMIN no puede desactivar al propietario (SUPER_ADMIN)');
    }

    await this.prisma.member.update({
      where: { id: memberId },
      data: { status: 'SUSPENDED' },
    });

    const targetUserId = membership.userId;
    const [activeMembers, activeCompanyMembers] = await Promise.all([
      this.prisma.member.count({ where: { userId: targetUserId, status: 'ACTIVE' } }),
      this.prisma.companyMember.count({ where: { userId: targetUserId, status: 'ACTIVE' } }),
    ]);
    if (activeMembers === 0 && activeCompanyMembers === 0) {
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { isActive: false },
      });
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { email: true },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        userId: requesterUserId,
        action: 'MEMBER_DEACTIVATED',
        entityType: 'member',
        entityId: String(memberId),
        newValue: {
          targetUserId: membership.userId,
          email: membership.user.email,
          fullName: membership.user.fullName,
          role: membership.role,
        },
        actorEmail: actor?.email ?? undefined,
        targetSummary: `Usuario desactivado: ${membership.user.fullName || membership.user.email} (${membership.role})`,
      },
    });

    return {
      message: 'Usuario desactivado de la organización. Sus facturas y actividad se mantienen.',
      userId: membership.userId,
      email: membership.user.email,
      fullName: membership.user.fullName,
      organizationId,
    };
  }

  /**
   * Elimina (desactiva) un usuario de una organización por userId.
   * Reglas:
   * - Un usuario no puede eliminarse a sí mismo
   * - Solo OWNER o ADMIN puede eliminar (en este sistema, SUPER_ADMIN se considera OWNER)
   *
   * Nota: Se hace "soft-remove" de la membresía (status = SUSPENDED) para auditoría.
   */
  async removeUserFromOrganization(params: {
    organizationId: number;
    targetUserId: number;
    requesterUserId: number;
    requesterRole: unknown;
  }) {
    const { organizationId, targetUserId, requesterUserId, requesterRole } = params;

    if (targetUserId === requesterUserId) {
      throw new BadRequestException('No puedes eliminarte a ti mismo');
    }

    const role = String(requesterRole || '').toUpperCase().trim();
    const perms = getPermissions(role);
    if (!perms.canManageUsers) {
      throw new ForbiddenException('Solo un administrador puede eliminar usuarios');
    }

    const membership = await this.prisma.member.findFirst({
      where: {
        userId: targetUserId,
        organizationId,
        status: 'ACTIVE',
      },
      include: {
        user: {
          select: { id: true, email: true, fullName: true },
        },
      },
    });

    if (!membership) {
      throw new NotFoundException(
        'El usuario no es un miembro activo de esta organización',
      );
    }

    // Seguridad adicional: un ADMIN no puede eliminar un SUPER_ADMIN
    if (!canDeleteSuperAdmin(role) && String(membership.role).toUpperCase() === ROLES.SUPER_ADMIN) {
      throw new ForbiddenException('Un ADMIN no puede eliminar un SUPER_ADMIN');
    }

    await this.prisma.member.update({
      where: { id: membership.id },
      data: { status: 'SUSPENDED' },
    });

    const [activeMembers, activeCompanyMembers] = await Promise.all([
      this.prisma.member.count({ where: { userId: targetUserId, status: 'ACTIVE' } }),
      this.prisma.companyMember.count({ where: { userId: targetUserId, status: 'ACTIVE' } }),
    ]);
    if (activeMembers === 0 && activeCompanyMembers === 0) {
      await this.prisma.user.update({
        where: { id: targetUserId },
        data: { isActive: false },
      });
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: requesterUserId },
      select: { email: true },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId,
        userId: requesterUserId,
        action: 'MEMBER_DEACTIVATED',
        entityType: 'member',
        entityId: String(membership.id),
        newValue: {
          targetUserId: membership.userId,
          email: membership.user.email,
          fullName: membership.user.fullName,
          role: membership.role,
        },
        actorEmail: actor?.email ?? undefined,
        targetSummary: `Usuario desactivado: ${membership.user.fullName || membership.user.email} (${membership.role})`,
      },
    });

    return {
      message: 'Usuario eliminado de la organización',
      userId: membership.userId,
      email: membership.user.email,
      fullName: membership.user.fullName,
      organizationId,
    };
  }

  /**
   * Historial de acciones sensibles (audit log). Solo SUPER_ADMIN y ADMIN.
   */
  async getAuditLog(organizationId: number, limit = 100) {
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        oldValue: true,
        newValue: true,
        actorEmail: true,
        targetSummary: true,
        createdAt: true,
      },
    });
    return logs;
  }

  /**
   * Auditoría de acciones (Activity Log): quién cambió precio, eliminó factura, autoconsumo, etc.
   */
  async getActivityLog(organizationId: number, limit = 100) {
    const logs = await this.prisma.activityLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    return logs;
  }

  /**
   * Crea una nueva organización
   * SOLO el Super Admin puede crear organizaciones
   */
  async create(createOrganizationDto: CreateOrganizationDto, userId: number) {
    // Validar que el usuario es Super Admin
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    });

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    if (!user.isSuperAdmin) {
      throw new ForbiddenException(
        'Solo el Super Admin puede crear organizaciones',
      );
    }

    // Validar que el slug no existe
    const existingOrg = await this.prisma.organization.findUnique({
      where: { slug: createOrganizationDto.slug },
    });

    if (existingOrg) {
      throw new ConflictException(
        `Ya existe una organización con el slug: ${createOrganizationDto.slug}`,
      );
    }

    // Crear la organización
    const organization = await this.prisma.organization.create({
      data: {
        nombre: createOrganizationDto.nombre,
        slug: createOrganizationDto.slug,
        plan: createOrganizationDto.plan || 'FREE',
      },
    });

    // Asignar al Super Admin como SUPER_ADMIN de la nueva organización.
    // Usar findFirst + create para evitar Unique constraint si ya existe (p. ej. por reintento).
    const existingMember = await this.prisma.member.findFirst({
      where: { userId, organizationId: organization.id },
    });
    if (!existingMember) {
      try {
        await this.prisma.member.create({
          data: {
            userId: userId,
            organizationId: organization.id,
            role: 'SUPER_ADMIN',
            status: 'ACTIVE',
          },
        });
      } catch (e: any) {
        // Unique constraint: Super Admin ya es miembro, ignorar
        if (e?.code !== 'P2002') throw e;
      }
    }

    return organization;
  }

  /**
   * Purga usuarios desactivados hace más de 6 meses sin facturas ni tareas vinculadas.
   * Solo SUPER_ADMIN. Devuelve cuántos se eliminaron.
   */
  async purgeInactiveUsers(actorUserId: number): Promise<{ purged: number }> {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorUserId },
      select: { isSuperAdmin: true },
    });
    if (!actor?.isSuperAdmin) {
      throw new ForbiddenException('Solo el Super Admin puede ejecutar la purga');
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const candidates = await this.prisma.user.findMany({
      where: {
        isActive: false,
        updatedAt: { lt: sixMonthsAgo },
        isSuperAdmin: false,
      },
      select: { id: true },
    });

    let purged = 0;
    for (const u of candidates) {
      const [invCount, taskCount] = await Promise.all([
        this.prisma.invoice.count({ where: { sellerId: u.id } }),
        this.prisma.task.count({ where: { OR: [{ assignedToId: u.id }, { createdById: u.id }] } }),
      ]);
      if (invCount === 0 && taskCount === 0) {
        await this.prisma.member.deleteMany({ where: { userId: u.id } });
        await this.prisma.companyMember.deleteMany({ where: { userId: u.id } });
        await this.prisma.user.delete({ where: { id: u.id } });
        purged++;
      }
    }

    return { purged };
  }

  /**
   * Historial de tasas BCV para la organización (auditoría y reportes).
   * Query: desde?, hasta?, limit?
   */
  async getTasasHistorial(
    organizationId: number,
    opts?: { desde?: string; hasta?: string; limit?: number },
  ) {
    const limit = Math.min(opts?.limit ?? 200, 500);
    const where: {
      organizationId: number;
      effectiveAt?: { gte?: Date; lte?: Date };
    } = { organizationId };
    if (opts?.desde || opts?.hasta) {
      where.effectiveAt = {};
      if (opts.desde) {
        where.effectiveAt.gte = new Date(opts.desde);
      }
      if (opts.hasta) {
        const h = new Date(opts.hasta);
        h.setHours(23, 59, 59, 999);
        where.effectiveAt.lte = h;
      }
    }
    const list = await this.prisma.tasaHistorica.findMany({
      where,
      orderBy: { effectiveAt: 'desc' },
      take: limit,
      select: {
        id: true,
        rate: true,
        source: true,
        effectiveAt: true,
        createdAt: true,
      },
    });
    return list.map((t) => ({
      id: t.id,
      rate: Number(t.rate),
      source: t.source,
      effectiveAt: t.effectiveAt,
      createdAt: t.createdAt,
    }));
  }

  /**
   * Reporte Ganancia/Pérdida por Diferencial Cambiario.
   * Por cada día en el rango: tasa utilizada (promedio), total facturado USD/BS y número de facturas.
   * Opcional: diferencia entre tasa del día y tasa de cierre para estimar diferencial.
   */
  async getReporteDiferencialCambiario(
    organizationId: number,
    desde: string,
    hasta: string,
  ) {
    const desdeDate = new Date(desde);
    const hastaDate = new Date(hasta);
    hastaDate.setHours(23, 59, 59, 999);

    const [tasas, facturas] = await Promise.all([
      this.prisma.tasaHistorica.findMany({
        where: {
          organizationId,
          effectiveAt: { gte: desdeDate, lte: hastaDate },
        },
        orderBy: { effectiveAt: 'asc' },
        select: { rate: true, effectiveAt: true },
      }),
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          createdAt: { gte: desdeDate, lte: hastaDate },
          status: { not: 'CANCELLED' },
        },
        select: {
          id: true,
          totalAmount: true,
          montoUsd: true,
          montoBs: true,
          createdAt: true,
          tasaHistoricaId: true,
          tasaHistorica: { select: { rate: true } },
        },
      }),
    ]);

    // Agrupar por día (YYYY-MM-DD)
    const byDay: Record<
      string,
      {
        date: string;
        tasaPromedio: number;
        tasaMin: number;
        tasaMax: number;
        totalUsd: number;
        totalBs: number;
        numFacturas: number;
      }
    > = {};

    const pushDay = (dateStr: string, tasa: number, totalUsd: number, totalBs: number) => {
      if (!byDay[dateStr]) {
        byDay[dateStr] = {
          date: dateStr,
          tasaPromedio: 0,
          tasaMin: tasa,
          tasaMax: tasa,
          totalUsd: 0,
          totalBs: 0,
          numFacturas: 0,
        };
      }
      const d = byDay[dateStr];
      d.totalUsd += totalUsd;
      d.totalBs += totalBs;
      d.numFacturas += 1;
      const prevProm = d.tasaPromedio * (d.numFacturas - 1);
      d.tasaPromedio = (prevProm + tasa) / d.numFacturas;
      d.tasaMin = Math.min(d.tasaMin, tasa);
      d.tasaMax = Math.max(d.tasaMax, tasa);
    };

    for (const inv of facturas) {
      const montoUsd = Number(inv.montoUsd ?? 0);
      const montoBs = Number(inv.montoBs ?? 0);
      const tasa = inv.tasaHistorica ? Number(inv.tasaHistorica.rate) : 0;
      const dateStr = inv.createdAt.toISOString().slice(0, 10);
      if (montoUsd > 0 || montoBs > 0) {
        pushDay(dateStr, tasa, montoUsd, montoBs);
      } else {
        pushDay(dateStr, tasa, Number(inv.totalAmount), 0);
      }
    }

    const sorted = Object.values(byDay).sort(
      (a, b) => a.date.localeCompare(b.date),
    );
    return {
      desde,
      hasta,
      resumenPorDia: sorted,
      totalFacturas: facturas.length,
      tasasEnRango: tasas.length,
    };
  }
}
