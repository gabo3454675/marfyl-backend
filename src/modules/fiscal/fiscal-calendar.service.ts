import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ComplianceStatus, FiscalTaxpayerType } from "@prisma/client";
import { rifLastDigitFromTaxId } from "./helpers/fiscal-validators";
import * as fs from "fs";
import * as path from "path";

interface ObligationDef {
  code: string;
  name: string;
  taxpayerTypes: FiscalTaxpayerType[];
  periodicity: "MENSUAL" | "QUINCENAL" | "ANUAL";
  dueMonthOffset?: number;
  dueDayOfMonth?: number;
  fortnight?: number;
  rulesByRifDigit?: boolean;
  requiresWithholdingAgent?: boolean;
  rules?: { rifDigitMin: number; rifDigitMax: number; dueDayOfMonth: number }[];
}

interface RulesJson {
  version: string;
  terminacionRifIvaOrdinario?: Record<string, number>;
  obligations: ObligationDef[];
}

@Injectable()
export class FiscalCalendarService {
  private readonly logger = new Logger(FiscalCalendarService.name);

  constructor(private readonly prisma: PrismaService) {}

  private resolveRulesPath(): string | null {
    const candidates = [
      path.join(process.cwd(), "docs", "FISCAL-CALENDARIO-REGLAS.json"),
      path.join(process.cwd(), "..", "docs", "FISCAL-CALENDARIO-REGLAS.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  loadRulesJson(): RulesJson | null {
    const file = this.resolveRulesPath();
    if (!file) return null;
    return JSON.parse(fs.readFileSync(file, "utf-8")) as RulesJson;
  }

  /** Sincroniza plantillas y reglas desde JSON (reemplaza reglas por codigo de obligacion). */
  async syncSeniatRulesFromJson(force = false) {
    const data = this.loadRulesJson();
    if (!data) {
      this.logger.warn("FISCAL-CALENDARIO-REGLAS.json no encontrado");
      return { synced: false };
    }

    const count = await this.prisma.fiscalObligationTemplate.count();
    if (count > 0 && !force) {
      return {
        synced: false,
        message: "Ya existen plantillas. Use force=true para resincronizar.",
      };
    }

    if (force) {
      await this.prisma.fiscalCalendarRule.deleteMany({});
      await this.prisma.fiscalDeadline.deleteMany({});
      await this.prisma.fiscalObligationTemplate.deleteMany({});
    }

    const terminacion = data.terminacionRifIvaOrdinario ?? {};

    for (const ob of data.obligations) {
      const template = await this.prisma.fiscalObligationTemplate.upsert({
        where: { code: ob.code },
        create: {
          code: ob.code,
          name: ob.name,
          taxpayerTypes: ob.taxpayerTypes,
          periodicity: ob.periodicity,
        },
        update: {
          name: ob.name,
          taxpayerTypes: ob.taxpayerTypes,
          periodicity: ob.periodicity,
          isActive: true,
        },
      });

      await this.prisma.fiscalCalendarRule.deleteMany({
        where: { templateId: template.id },
      });

      if (ob.rulesByRifDigit) {
        for (let d = 0; d <= 9; d++) {
          const day = terminacion[String(d)] ?? 10 + d;
          await this.prisma.fiscalCalendarRule.create({
            data: {
              templateId: template.id,
              rifDigitMin: d,
              rifDigitMax: d,
              dueDayOfMonth: day,
              dueMonthOffset: ob.dueMonthOffset ?? 1,
              version: data.version,
            },
          });
        }
      } else if (ob.rules?.length) {
        for (const rule of ob.rules) {
          await this.prisma.fiscalCalendarRule.create({
            data: {
              templateId: template.id,
              rifDigitMin: rule.rifDigitMin,
              rifDigitMax: rule.rifDigitMax,
              dueDayOfMonth: rule.dueDayOfMonth,
              dueMonthOffset: ob.dueMonthOffset ?? 1,
              version: data.version,
            },
          });
        }
      } else if (ob.dueDayOfMonth != null) {
        await this.prisma.fiscalCalendarRule.create({
          data: {
            templateId: template.id,
            rifDigitMin: 0,
            rifDigitMax: 9,
            dueDayOfMonth: ob.dueDayOfMonth,
            dueMonthOffset: ob.dueMonthOffset ?? 0,
            version: data.version,
          },
        });
      }
    }

    return {
      synced: true,
      version: data.version,
      obligations: data.obligations.length,
    };
  }

  async seedTemplatesFromJsonIfEmpty() {
    const count = await this.prisma.fiscalObligationTemplate.count();
    if (count === 0) {
      await this.syncSeniatRulesFromJson(true);
    }
  }

  async recalculateDeadlines(
    organizationId: number,
    year: number,
    month: number,
  ) {
    await this.seedTemplatesFromJsonIfEmpty();

    const [org, profile] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.fiscalProfile.findUnique({ where: { organizationId } }),
    ]);
    if (!org) return [];

    const taxpayerType =
      profile?.taxpayerType ??
      (org.isSpecialTaxpayer
        ? FiscalTaxpayerType.ESPECIAL
        : FiscalTaxpayerType.ORDINARIO);

    const digit =
      profile?.rifLastDigit ??
      rifLastDigitFromTaxId(profile?.taxId ?? org.taxId) ??
      0;

    const templates = await this.prisma.fiscalObligationTemplate.findMany({
      where: { isActive: true, taxpayerTypes: { has: taxpayerType } },
      include: { rules: { where: { isActive: true } } },
    });

    const results = [];
    for (const tpl of templates) {
      if (tpl.code === "RETENCIONES_IVA" && !profile?.isWithholdingAgent) {
        continue;
      }

      const rule = tpl.rules.find(
        (r) => digit >= r.rifDigitMin && digit <= r.rifDigitMax,
      );
      if (!rule) continue;

      const dueDate = new Date(
        year,
        month - 1 + rule.dueMonthOffset,
        rule.dueDayOfMonth,
      );
      const compliance = await this.computeCompliance(
        organizationId,
        year,
        month,
        tpl.code,
      );

      const deadline = await this.prisma.fiscalDeadline.upsert({
        where: {
          organizationId_templateId_periodYear_periodMonth: {
            organizationId,
            templateId: tpl.id,
            periodYear: year,
            periodMonth: month,
          },
        },
        create: {
          organizationId,
          templateId: tpl.id,
          periodYear: year,
          periodMonth: month,
          dueDate,
          compliance,
        },
        update: { dueDate, compliance },
        include: { template: true },
      });
      results.push({
        ...deadline,
        rifDigit: digit,
        terminacionLabel: `Terminacion RIF: ${digit}`,
      });
    }
    return results;
  }

  private async computeCompliance(
    organizationId: number,
    year: number,
    month: number,
    obligationCode: string,
  ): Promise<ComplianceStatus> {
    const period = await this.prisma.fiscalPeriod.findUnique({
      where: { organizationId_year_month: { organizationId, year, month } },
    });
    if (period?.status === "CLOSED") return ComplianceStatus.CLOSED;

    const profile = await this.prisma.fiscalProfile.findUnique({
      where: { organizationId },
    });
    if (!profile?.taxId?.trim()) return ComplianceStatus.RED;

    const [ventas, compras] = await Promise.all([
      this.prisma.libroVentaLine.count({
        where: {
          organizationId,
          periodYear: year,
          periodMonth: month,
          status: "ACTIVE",
        },
      }),
      this.prisma.libroCompraLine.count({
        where: {
          organizationId,
          periodYear: year,
          periodMonth: month,
          status: "ACTIVE",
        },
      }),
    ]);

    if (ventas === 0 && compras === 0) return ComplianceStatus.RED;

    const invalidVentas = await this.prisma.libroVentaLine.count({
      where: {
        organizationId,
        periodYear: year,
        periodMonth: month,
        status: "ACTIVE",
        baseGeneral: { gt: 0 },
        OR: [{ customerTaxId: null }, { customerTaxId: "" }],
      },
    });

    if (invalidVentas > 0) return ComplianceStatus.YELLOW;

    const missingControl = await this.prisma.libroVentaLine.count({
      where: {
        organizationId,
        periodYear: year,
        periodMonth: month,
        status: "ACTIVE",
        OR: [{ controlNumber: null }, { controlNumber: "" }],
      },
    });
    if (missingControl > 0 && obligationCode.startsWith("IVA")) {
      return ComplianceStatus.YELLOW;
    }

    if (obligationCode === "RETENCIONES_IVA" && profile.isWithholdingAgent) {
      const retCount = await this.prisma.retencionIVA.count({
        where: { organizationId, periodYear: year, periodMonth: month },
      });
      if (retCount === 0 && compras > 0) return ComplianceStatus.YELLOW;
    }

    const daysToDue = await this.prisma.fiscalDeadline.findFirst({
      where: {
        organizationId,
        periodYear: year,
        periodMonth: month,
        template: { code: obligationCode },
      },
    });
    if (daysToDue) {
      const daysLeft = Math.ceil(
        (daysToDue.dueDate.getTime() - Date.now()) / 86400000,
      );
      if (daysLeft <= 3 && daysLeft >= 0) return ComplianceStatus.YELLOW;
    }

    return ComplianceStatus.GREEN;
  }

  async listCalendar(organizationId: number, year: number, month: number) {
    await this.recalculateDeadlines(organizationId, year, month);
    const deadlines = await this.prisma.fiscalDeadline.findMany({
      where: { organizationId, periodYear: year, periodMonth: month },
      include: { template: true },
      orderBy: { dueDate: "asc" },
    });

    const profile = await this.prisma.fiscalProfile.findUnique({
      where: { organizationId },
    });
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const digit =
      profile?.rifLastDigit ??
      rifLastDigitFromTaxId(profile?.taxId ?? org?.taxId);

    const rules = this.loadRulesJson();
    const terminacionDay =
      digit != null && rules?.terminacionRifIvaOrdinario
        ? rules.terminacionRifIvaOrdinario[String(digit)]
        : null;

    return {
      year,
      month,
      rifDigit: digit,
      terminacionIvaDay: terminacionDay,
      seniatVersion: rules?.version ?? null,
      deadlines,
    };
  }
}
