import { Injectable, Logger } from '@nestjs/common';
import { FiscalNormStatus } from '@prisma/client';
import { PrismaService } from '@/common/prisma/prisma.service';
import { FiscalCalendarService } from './fiscal-calendar.service';
@Injectable()
export class FiscalNormsService {
  private readonly logger = new Logger(FiscalNormsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: FiscalCalendarService,
  ) {}

  /**
   * Crea normas versionadas desde el JSON SENIAT sin editar versiones activas in-place.
   */
  async syncNormsFromCalendarJson(userId?: number) {
    const data = this.calendar.loadRulesJson();
    if (!data) {
      return { synced: false, message: 'JSON de reglas no encontrado' };
    }

    const validFrom = new Date(`${data.version}-01-01T00:00:00.000Z`);
    let created = 0;
    let superseded = 0;

    try {
      for (const ob of data.obligations) {
        const norm = await this.prisma.fiscalNorm.upsert({
          where: { code: ob.code },
          create: {
            code: ob.code,
            name: ob.name,
            legalReference: `Calendario SENIAT ${data.version}`,
            officialSource: 'docs/FISCAL-CALENDARIO-REGLAS.json',
            priority: ob.code.startsWith('IVA') ? 10 : 50,
          },
          update: { name: ob.name, isActive: true },
        });

        const existingActive = await this.prisma.fiscalNormVersion.findFirst({
          where: { normId: norm.id, status: 'ACTIVE', versionCode: data.version },
        });

        if (existingActive) continue;

        await this.prisma.fiscalNormVersion.updateMany({
          where: { normId: norm.id, status: 'ACTIVE' },
          data: { status: FiscalNormStatus.SUPERSEDED, validTo: new Date() },
        });
        superseded += 1;

        const version = await this.prisma.fiscalNormVersion.create({
          data: {
            normId: norm.id,
            versionCode: data.version,
            articleRef: ob.code,
            validFrom,
            status: FiscalNormStatus.ACTIVE,
            sourceDocument: 'FISCAL-CALENDARIO-REGLAS.json',
            notes: ob.periodicity,
            metadata: { taxpayerTypes: ob.taxpayerTypes },
            createdByUserId: userId,
          },
        });

        const template = await this.prisma.fiscalObligationTemplate.findUnique({
          where: { code: ob.code },
        });
        if (template) {
          await this.prisma.fiscalCalendarRule.updateMany({
            where: { templateId: template.id, version: data.version },
            data: { normVersionId: version.id },
          });
        }
        created += 1;
      }

      await this.prisma.fiscalSyncRun.create({
        data: {
          syncType: 'NORMS',
          status: 'SUCCESS',
          versionLabel: data.version,
          finishedAt: new Date(),
          metadata: { created, superseded },
        },
      });

    } catch (err) {
      this.logger.warn(`Normas: migración pendiente o error — ${String(err)}`);
      return { synced: false, message: 'Ejecute migración fiscal_compliance_layers' };
    }

    return { synced: true, version: data.version, created, superseded };
  }

  async listActive() {
    try {
      return await this.prisma.fiscalNorm.findMany({
        where: { isActive: true },
        include: {
          versions: {
            where: { status: 'ACTIVE' },
            orderBy: { validFrom: 'desc' },
            take: 1,
          },
        },
        orderBy: { priority: 'asc' },
      });
    } catch {
      return [];
    }
  }
}
