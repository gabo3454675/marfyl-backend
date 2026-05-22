import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface LogActionParams {
  organizationId: number;
  userId: number;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  summary?: string;
}

/**
 * Auditoría de acciones en sistema multi-tenant.
 * Registra quién cambió un precio, eliminó una factura, registró autoconsumo, etc.
 */
@Injectable()
export class ActivityLogService {
  constructor(private readonly prisma: PrismaService) {}

  async log(params: LogActionParams): Promise<void> {
    const {
      organizationId,
      userId,
      action,
      entityType,
      entityId,
      oldValue,
      newValue,
      summary,
    } = params;
    await this.prisma.activityLog.create({
      data: {
        organizationId,
        userId,
        action,
        entityType,
        entityId,
        oldValue: oldValue !== undefined && oldValue !== null ? (oldValue as Prisma.InputJsonValue) : undefined,
        newValue: newValue !== undefined && newValue !== null ? (newValue as Prisma.InputJsonValue) : undefined,
        summary: summary ?? undefined,
      },
    });
  }
}
