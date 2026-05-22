import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { getRoleOrder } from '@/common/constants/roles.constants';
import { CreateTaskDto } from './dto/create-task.dto';
import { TaskStatus, TaskPriority } from '@prisma/client';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea una tarea y la asigna a un usuario.
   * Valida que creador y asignado pertenezcan a la misma organización.
   * Valida que el rol del creador sea superior o igual al del asignado (ej: Cajero no puede asignar a Gerente).
   * La tarea se guarda con read: false para indicador visual de no leída.
   */
  async create(
    dto: CreateTaskDto,
    organizationId: number,
    createdById: number,
  ) {
    // Verificar que el creador es miembro de la organización
    const creatorMembership = await this.prisma.member.findFirst({
      where: {
        userId: createdById,
        organizationId,
        status: 'ACTIVE',
      },
    });
    if (!creatorMembership) {
      throw new ForbiddenException(
        'No tienes acceso a esta organización para crear tareas',
      );
    }

    // Verificar que el asignado es miembro de la misma organización
    const assignedMembership = await this.prisma.member.findFirst({
      where: {
        userId: dto.assignedToId,
        organizationId,
        status: 'ACTIVE',
      },
    });
    if (!assignedMembership) {
      throw new BadRequestException(
        'El usuario asignado no pertenece a esta organización o no está activo',
      );
    }

    // Seguridad: el creador solo puede asignar a usuarios con rol inferior o igual al suyo
    const creatorWeight = getRoleOrder(creatorMembership.role);
    const assignedWeight = getRoleOrder(assignedMembership.role);
    if (creatorWeight < assignedWeight) {
      throw new ForbiddenException(
        'No puedes asignar tareas a un usuario con rol superior al tuyo',
      );
    }

    // Opcional: validar que la factura existe y pertenece a la organización
    if (dto.invoiceId != null) {
      const invoice = await this.prisma.invoice.findFirst({
        where: {
          id: dto.invoiceId,
          organizationId,
        },
      });
      if (!invoice) {
        throw new BadRequestException(
          'La factura indicada no existe o no pertenece a esta organización',
        );
      }
    }

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description ?? undefined,
        status: (dto.status as TaskStatus) ?? TaskStatus.PENDING,
        priority: dto.priority ?? TaskPriority.LOW,
        read: false,
        organizationId,
        assignedToId: dto.assignedToId,
        createdById,
        invoiceId: dto.invoiceId ?? undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        category: dto.category ?? undefined,
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        invoice: dto.invoiceId
          ? {
              select: {
                id: true,
                totalAmount: true,
                status: true,
              },
            }
          : false,
      },
    });

    return task;
  }

  /**
   * Obtiene las tareas pendientes (PENDING o IN_PROGRESS) del usuario logueado.
   * category opcional: ej. "COBRANZA" para filtrar.
   */
  /**
   * Tareas pendientes asignadas al usuario, solo de la organización activa (x-tenant-id).
   */
  async getMyPending(userId: number, organizationId: number, category?: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        assignedToId: userId,
        organizationId,
        status: {
          in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
        },
        ...(category ? { category } : {}),
      },
      include: {
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        organization: {
          select: {
            id: true,
            nombre: true,
          },
        },
        invoice: {
          select: {
            id: true,
            totalAmount: true,
            status: true,
          },
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return tasks;
  }

  /**
   * Actualiza el estado de una tarea (ej. marcar como DONE).
   * Solo el asignado o un admin de la organización pueden cambiar el estado.
   */
  async updateStatus(
    taskId: number,
    status: TaskStatus,
    userId: number,
    organizationId: number,
  ) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        organizationId,
      },
    });

    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }

    const isAssigned = task.assignedToId === userId;
    const membership = await this.prisma.member.findFirst({
      where: {
        userId,
        organizationId,
        status: 'ACTIVE',
      },
    });
    const isAdmin =
      membership &&
      (membership.role === 'ADMIN' || membership.role === 'SUPER_ADMIN');

    if (!isAssigned && !isAdmin) {
      throw new ForbiddenException(
        'Solo el asignado o un administrador pueden cambiar el estado de la tarea',
      );
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { status },
      include: {
        assignedTo: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        invoice: {
          select: {
            id: true,
            totalAmount: true,
            status: true,
          },
        },
      },
    });

    return updated;
  }

  /**
   * Cuenta tareas no leídas asignadas al usuario (para badge de notificaciones).
   */
  /**
   * Cuenta de tareas no leídas del usuario en la organización activa.
   */
  async getMyUnreadCount(userId: number, organizationId: number): Promise<{ count: number }> {
    const count = await this.prisma.task.count({
      where: {
        assignedToId: userId,
        organizationId,
        read: false,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
      },
    });
    return { count };
  }

  /**
   * Marca una tarea como leída. Solo el asignado o un admin de la organización.
   * organizationId se obtiene de la tarea (no requiere header).
   */
  async markAsRead(taskId: number, userId: number) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });
    if (!task) {
      throw new NotFoundException('Tarea no encontrada');
    }
    const organizationId = task.organizationId;
    const isAssigned = task.assignedToId === userId;
    const membership = await this.prisma.member.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
    });
    const isAdmin =
      membership &&
      (membership.role === 'ADMIN' || membership.role === 'SUPER_ADMIN');
    if (!isAssigned && !isAdmin) {
      throw new ForbiddenException(
        'Solo el asignado o un administrador pueden marcar la tarea como leída',
      );
    }
    await this.prisma.task.update({
      where: { id: taskId },
      data: { read: true },
    });
    return { ok: true };
  }

  /**
   * Tareas creadas por el usuario (para que el gerente vea estado actualizado por el asignado).
   */
  /**
   * Tareas creadas por el usuario, solo de la organización activa.
   */
  async getCreatedByMe(userId: number, organizationId: number) {
    const tasks = await this.prisma.task.findMany({
      where: { createdById: userId, organizationId },
      include: {
        assignedTo: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
        organization: {
          select: { id: true, nombre: true },
        },
        invoice: {
          select: { id: true, totalAmount: true, status: true },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
    });
    return tasks;
  }
}
