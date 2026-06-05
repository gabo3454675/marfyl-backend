import { Injectable } from "@nestjs/common";
import { FiscalDomainEventType } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { FiscalAuditService } from "./fiscal-audit.service";

export interface EmitFiscalEventInput {
  organizationId: number;
  eventType: FiscalDomainEventType;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  userId?: number;
  auditAction?: string;
}

@Injectable()
export class FiscalEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: FiscalAuditService,
  ) {}

  async emit(input: EmitFiscalEventInput) {
    let event = null;
    try {
      event = await this.prisma.fiscalDomainEvent.create({
        data: {
          organizationId: input.organizationId,
          eventType: input.eventType,
          entityType: input.entityType,
          entityId: input.entityId,
          payload: input.payload as object | undefined,
          userId: input.userId,
        },
      });
    } catch {
      // Tabla aún no migrada
    }

    if (input.auditAction) {
      await this.audit.log({
        organizationId: input.organizationId,
        userId: input.userId,
        action: input.auditAction,
        entityType: input.entityType ?? "fiscal_event",
        entityId: input.entityId,
        afterValue: { eventType: input.eventType, payload: input.payload },
        systemResponse: event ? { eventId: event.id } : { persisted: false },
      });
    }

    return event;
  }

  async listRecent(organizationId: number, limit = 15) {
    try {
      return await this.prisma.fiscalDomainEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    } catch {
      return [];
    }
  }
}
