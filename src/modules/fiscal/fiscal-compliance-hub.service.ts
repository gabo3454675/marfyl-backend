import { Injectable } from "@nestjs/common";
import { FiscalAlertSeverity, FiscalAlertStatus } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { FiscalCalendarService } from "./fiscal-calendar.service";
import { FiscalRuleEngineService } from "./fiscal-rule-engine.service";
import { FiscalAuditService } from "./fiscal-audit.service";
import { FiscalEventsService } from "./fiscal-events.service";

export interface ComplianceHubAlertDto {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  problem: string;
  risk: string;
  action: string;
  actionHref?: string;
  ruleCode?: string;
  blocksOperation: boolean;
  source: "persisted" | "computed";
}

@Injectable()
export class FiscalComplianceHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: FiscalCalendarService,
    private readonly ruleEngine: FiscalRuleEngineService,
    private readonly audit: FiscalAuditService,
    private readonly events: FiscalEventsService,
  ) {}

  private mapSeverity(s: FiscalAlertSeverity): "info" | "warning" | "critical" {
    const m: Record<FiscalAlertSeverity, "info" | "warning" | "critical"> = {
      INFO: "info",
      WARNING: "warning",
      CRITICAL: "critical",
    };
    return m[s];
  }

  private buildComputedAlerts(
    mode: { mode: string; reasons: string[] },
    calendar: Awaited<ReturnType<FiscalCalendarService["listCalendar"]>>,
  ): ComplianceHubAlertDto[] {
    const alerts: ComplianceHubAlertDto[] = [];

    if (mode.mode === "DIAGNOSTIC") {
      alerts.push({
        id: "diag-profile",
        severity: "critical",
        title: "Modo diagnóstico activo",
        problem: mode.reasons.join(" "),
        risk: "Sin perfil completo el motor no puede aplicar reglas ni calendario SENIAT con confianza.",
        action: "Completar perfil fiscal",
        actionHref: "/fiscal/perfil",
        ruleCode: "PROFILE_COMPLETENESS",
        blocksOperation: false,
        source: "computed",
      });
    }

    for (const d of calendar.deadlines ?? []) {
      const due = new Date(d.dueDate);
      const daysLeft = Math.ceil((due.getTime() - Date.now()) / 86400000);
      if (d.compliance === "RED" || daysLeft < 0) {
        alerts.push({
          id: `deadline-${d.id}`,
          severity: "critical",
          title: `${d.template.name} — vencimiento crítico`,
          problem:
            daysLeft < 0
              ? `Venció hace ${Math.abs(daysLeft)} día(s).`
              : "Estado de cumplimiento en rojo.",
          risk: "Multas o sanciones según normativa vigente.",
          action: "Revisar obligación",
          actionHref: "/fiscal",
          ruleCode: d.template.code,
          blocksOperation: false,
          source: "computed",
        });
      }
    }

    return alerts;
  }

  async getHub(organizationId: number, year: number, month: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      include: { fiscalProfile: true },
    });

    const identity = this.ruleEngine.buildIdentityFromOrgProfile(
      {
        taxId: org?.taxId ?? null,
        legalName: org?.legalName ?? null,
        isSpecialTaxpayer: org?.isSpecialTaxpayer ?? false,
        isFormalTaxpayer: org?.isFormalTaxpayer ?? false,
      },
      org?.fiscalProfile ?? null,
    );
    const modeResult = this.ruleEngine.resolveMode(identity);

    const calendar = await this.calendar.listCalendar(
      organizationId,
      year,
      month,
    );
    const activeNorms = await this.ruleEngine.getActiveNormVersions();

    let persistedAlerts: ComplianceHubAlertDto[] = [];
    try {
      const rows = await this.prisma.fiscalComplianceAlert.findMany({
        where: { organizationId, status: FiscalAlertStatus.OPEN },
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 30,
      });
      persistedAlerts = rows.map((a) => ({
        id: `db-${a.id}`,
        severity: this.mapSeverity(a.severity),
        title: a.title,
        problem: a.problem,
        risk: a.risk,
        action: a.recommendedAction,
        ruleCode: a.ruleCode ?? undefined,
        blocksOperation: a.blocksOperation,
        source: "persisted" as const,
      }));
    } catch {
      // migración pendiente
    }

    const computed = this.buildComputedAlerts(modeResult, calendar);
    const seen = new Set<string>();
    const alerts = [...persistedAlerts, ...computed].filter((a) => {
      const key = `${a.ruleCode ?? a.id}-${a.severity}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const auditRecent = await this.audit.listRecent(organizationId, 10);
    const eventsRecent = await this.events.listRecent(organizationId, 10);

    let lastSyncAt: string | null =
      org?.fiscalProfile?.lastRulesSyncAt?.toISOString() ?? null;
    try {
      const lastRun = await this.prisma.fiscalSyncRun.findFirst({
        where: { syncType: "CALENDARIO", status: "SUCCESS" },
        orderBy: { finishedAt: "desc" },
      });
      if (lastRun?.finishedAt) lastSyncAt = lastRun.finishedAt.toISOString();
    } catch {
      // ignore
    }

    const criticalCount = alerts.filter(
      (a) => a.severity === "critical",
    ).length;
    const overdue = (calendar.deadlines ?? []).filter((d) => {
      const days = Math.ceil(
        (new Date(d.dueDate).getTime() - Date.now()) / 86400000,
      );
      return days < 0 || d.compliance === "RED";
    }).length;
    const upcoming = (calendar.deadlines ?? []).filter((d) => {
      const days = Math.ceil(
        (new Date(d.dueDate).getTime() - Date.now()) / 86400000,
      );
      return days >= 0 && days <= 14;
    }).length;

    let healthStatus: "healthy" | "attention" | "critical" = "healthy";
    if (modeResult.mode === "DIAGNOSTIC" || criticalCount > 0 || overdue > 0) {
      healthStatus =
        criticalCount > 0 || overdue > 0 ? "critical" : "attention";
    } else if (upcoming > 2) {
      healthStatus = "attention";
    }

    const score = Math.max(
      0,
      100 -
        modeResult.missingFields.length * 15 -
        criticalCount * 12 -
        overdue * 10 -
        (upcoming > 3 ? 5 : 0),
    );

    return {
      mode: modeResult.mode,
      modeReasons: modeResult.reasons,
      missingProfileFields: modeResult.missingFields,
      identity,
      calendar,
      alerts,
      health: {
        status: healthStatus,
        score,
        upcoming,
        overdue,
        missingConfig: modeResult.missingFields.length,
        criticalAlerts: criticalCount,
      },
      activeNormsCount: activeNorms.length,
      seniatVersion: calendar.seniatVersion,
      lastSyncAt,
      auditRecent: auditRecent.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        ruleCode: a.ruleCode,
        at: a.createdAt.toISOString(),
      })),
      eventsRecent: eventsRecent.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        entityType: e.entityType,
        at: e.createdAt.toISOString(),
      })),
    };
  }
}
