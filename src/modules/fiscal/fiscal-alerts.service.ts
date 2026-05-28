import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { PushNotificationService } from '@/modules/notifications/push-notification.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

@Injectable()
export class FiscalAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushNotificationService,
    private readonly notifications: NotificationsService,
  ) {}

  async getFcmTokensForOrgFiscal(organizationId: number): Promise<string[]> {
    const members = await this.prisma.member.findMany({
      where: {
        organizationId,
        role: { in: ['ADMIN', 'FISCAL'] },
        user: { fcmTokens: { some: {} } },
      },
      include: { user: { include: { fcmTokens: true } } },
    });
    const tokens: string[] = [];
    for (const m of members) {
      for (const t of m.user.fcmTokens) tokens.push(t.token);
    }
    return [...new Set(tokens)];
  }

  async logFiscalAlert(params: {
    organizationId: number;
    userId?: number;
    action: string;
    summary: string;
    entityId?: string;
  }) {
    if (!params.userId) return;
    await this.prisma.activityLog.create({
      data: {
        organizationId: params.organizationId,
        userId: params.userId,
        action: params.action,
        entityType: 'fiscal',
        entityId: params.entityId ?? '0',
        summary: params.summary,
      },
    });
  }

  async notifyMissingCustomerRif(params: {
    organizationId: number;
    organizationName: string;
    invoiceId: number;
    userId?: number;
  }) {
    await this.logFiscalAlert({
      organizationId: params.organizationId,
      userId: params.userId,
      action: 'FISCAL_WARNING_MISSING_RIF',
      summary: `Factura #${params.invoiceId}: operación gravada sin RIF del cliente.`,
      entityId: String(params.invoiceId),
    });
  }

  async notifyPeriodDeadline(params: {
    organizationId: number;
    organizationName: string;
    daysLeft: number;
    obligationName: string;
    netIvaBs: number;
    creditBs: number;
  }) {
    const tokens = await this.getFcmTokensForOrgFiscal(params.organizationId);
    const superTokens = await this.notifications.getFcmTokensForSuperAdmins();
    const all = [...new Set([...tokens, ...superTokens])];
    if (all.length === 0) return;

    const title = params.daysLeft <= 1 ? 'Vence mañana: obligación fiscal' : 'Recordatorio fiscal';
    const body =
      `${params.organizationName}: ${params.obligationName} vence en ${params.daysLeft} día(s). ` +
      `IVA neto est.: ${params.netIvaBs.toFixed(2)} Bs. Crédito: ${params.creditBs.toFixed(2)} Bs.`;

    await this.push.notifyFiscalReminder({
      tokens: all,
      title,
      body,
      organizationId: params.organizationId,
    });
  }

  async checkUpcomingDeadlines() {
    const now = new Date();
    const in3days = new Date(now);
    in3days.setDate(in3days.getDate() + 3);

    const deadlines = await this.prisma.fiscalDeadline.findMany({
      where: {
        dueDate: { gte: now, lte: in3days },
        compliance: { in: ['RED', 'YELLOW'] },
      },
      include: { template: true, organization: true },
    });

    for (const d of deadlines) {
      const daysLeft = Math.ceil((d.dueDate.getTime() - now.getTime()) / 86400000);
      const ventas = await this.prisma.libroVentaLine.aggregate({
        where: {
          organizationId: d.organizationId,
          periodYear: d.periodYear,
          periodMonth: d.periodMonth,
        },
        _sum: { ivaAmount: true },
      });
      const compras = await this.prisma.libroCompraLine.aggregate({
        where: {
          organizationId: d.organizationId,
          periodYear: d.periodYear,
          periodMonth: d.periodMonth,
        },
        _sum: { ivaAmount: true },
      });
      const rate = Number(d.organization.exchangeRate ?? 1);
      const net = Math.max(0, Number(ventas._sum.ivaAmount ?? 0) - Number(compras._sum.ivaAmount ?? 0));
      await this.notifyPeriodDeadline({
        organizationId: d.organizationId,
        organizationName: d.organization.nombre,
        daysLeft,
        obligationName: d.template.name,
        netIvaBs: net * rate,
        creditBs: Number(compras._sum.ivaAmount ?? 0) * rate,
      });
    }
  }
}
