import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FiscalAlertsService } from './fiscal-alerts.service';
import { FiscalCalendarService } from './fiscal-calendar.service';
import { PrismaService } from '@/common/prisma/prisma.service';

@Injectable()
export class FiscalSchedulerService {
  private readonly logger = new Logger(FiscalSchedulerService.name);

  constructor(
    private readonly alerts: FiscalAlertsService,
    private readonly calendar: FiscalCalendarService,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('0 8 * * *')
  async dailyFiscalChecks() {
    this.logger.log('Ejecutando revisión fiscal diaria');
    await this.calendar.seedTemplatesFromJsonIfEmpty();

    const orgs = await this.prisma.organization.findMany({
      select: { id: true },
    });
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    for (const org of orgs) {
      try {
        await this.calendar.recalculateDeadlines(org.id, year, month);
      } catch (e) {
        this.logger.warn(`Calendario org ${org.id}: ${e}`);
      }
    }

    await this.alerts.checkUpcomingDeadlines();
  }
}
