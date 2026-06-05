import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { NotificationsModule } from "@/modules/notifications/notifications.module";
import { FiscalController } from "./fiscal.controller";
import { FiscalService } from "./fiscal.service";
import { FiscalEngineService } from "./fiscal-engine.service";
import { FiscalCalendarService } from "./fiscal-calendar.service";
import { FiscalAlertsService } from "./fiscal-alerts.service";
import { FiscalSchedulerService } from "./fiscal-scheduler.service";
import { FiscalControlNumberService } from "./fiscal-control-number.service";
import { FiscalBackfillService } from "./fiscal-backfill.service";
import { RetencionPdfService } from "./retencion-pdf.service";
import { FiscalComplianceHubService } from "./fiscal-compliance-hub.service";
import { FiscalRuleEngineService } from "./fiscal-rule-engine.service";
import { FiscalValidationService } from "./fiscal-validation.service";
import { FiscalEventsService } from "./fiscal-events.service";
import { FiscalAuditService } from "./fiscal-audit.service";
import { FiscalNormsService } from "./fiscal-norms.service";

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FiscalController],
  providers: [
    FiscalService,
    FiscalEngineService,
    FiscalCalendarService,
    FiscalAlertsService,
    FiscalSchedulerService,
    FiscalControlNumberService,
    FiscalBackfillService,
    RetencionPdfService,
    FiscalComplianceHubService,
    FiscalRuleEngineService,
    FiscalValidationService,
    FiscalEventsService,
    FiscalAuditService,
    FiscalNormsService,
  ],
  exports: [
    FiscalEngineService,
    FiscalService,
    FiscalAlertsService,
    FiscalControlNumberService,
    FiscalValidationService,
    FiscalEventsService,
    FiscalAuditService,
    FiscalRuleEngineService,
  ],
})
export class FiscalModule {}
