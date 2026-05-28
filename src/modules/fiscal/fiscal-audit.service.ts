import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface FiscalAuditEntryInput {
  organizationId: number;
  userId?: number;
  action: string;
  entityType: string;
  entityId?: string;
  ruleCode?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  systemResponse?: unknown;
  userConfirmed?: boolean;
}

@Injectable()
export class FiscalAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: FiscalAuditEntryInput) {
    try {
      return await this.prisma.fiscalAuditLog.create({
        data: {
          organizationId: entry.organizationId,
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          ruleCode: entry.ruleCode,
          beforeValue: entry.beforeValue as object | undefined,
          afterValue: entry.afterValue as object | undefined,
          systemResponse: entry.systemResponse as object | undefined,
          userConfirmed: entry.userConfirmed,
        },
      });
    } catch {
      return null;
    }
  }

  async listRecent(organizationId: number, limit = 15) {
    try {
      return await this.prisma.fiscalAuditLog.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    } catch {
      return [];
    }
  }
}
