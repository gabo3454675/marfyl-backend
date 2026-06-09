import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DolarApiService } from "./dolar-api.service";
import type { DolarApiVenezuelaQuote } from "./dolar-api.types";

export interface ExchangeRateSyncResult {
  organizationId: number;
  updated: boolean;
  exchangeRate: number;
  previousRate: number | null;
  source: string;
  quote: DolarApiVenezuelaQuote;
  rateUpdatedAt: Date | null;
  rateUpdatedBy: string | null;
}

@Injectable()
export class ExchangeRateSyncService {
  private readonly logger = new Logger(ExchangeRateSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dolarApi: DolarApiService,
  ) {}

  async fetchQuotePreview() {
    const quote = await this.dolarApi.fetchQuote();
    return {
      exchangeRate: this.dolarApi.resolveUsdVesRate(quote),
      source: this.dolarApi.getSourceLabel(quote),
      quote,
      provider: "DolarApi.com",
      providerRepo: "https://github.com/enzonotario/esjs-dolar-api",
    };
  }

  async syncOrganization(
    organizationId: number,
    actorUserId?: number | null,
  ): Promise<ExchangeRateSyncResult> {
    const quote = await this.dolarApi.fetchQuote();
    const newRate = this.dolarApi.resolveUsdVesRate(quote);
    const source = this.dolarApi.getSourceLabel(quote);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true, currencyCode: true },
    });

    const previousRate = org?.exchangeRate ?? null;
    const changed =
      previousRate == null || Math.abs(previousRate - newRate) >= 0.0001;

    if (!changed) {
      return {
        organizationId,
        updated: false,
        exchangeRate: previousRate ?? newRate,
        previousRate,
        source,
        quote,
        rateUpdatedAt: null,
        rateUpdatedBy: null,
      };
    }

    const now = new Date();
    let actorEmail: string | null = null;
    if (actorUserId) {
      const actor = await this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { email: true },
      });
      actorEmail = actor?.email ?? null;
    }

    const rateUpdatedBy = actorEmail ?? "DolarApi BCV (automático)";

    await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          exchangeRate: newRate,
          rateUpdatedAt: now,
        },
      }),
      this.prisma.tasaHistorica.create({
        data: {
          organizationId,
          rate: newRate,
          source: source.includes("Paralelo") ? "PARALELO" : "BCV",
          effectiveAt: now,
        },
      }),
      ...(actorUserId
        ? [
            this.prisma.auditLog.create({
              data: {
                organizationId,
                userId: actorUserId,
                action: "CURRENCY_UPDATE",
                entityType: "organization",
                entityId: String(organizationId),
                oldValue:
                  previousRate != null
                    ? {
                        exchangeRate: previousRate,
                        currencyCode: org?.currencyCode ?? "USD",
                      }
                    : undefined,
                newValue: {
                  exchangeRate: newRate,
                  currencyCode: org?.currencyCode ?? "USD",
                  source: "DolarApi",
                },
                actorEmail: rateUpdatedBy,
                targetSummary: `Tasa BCV: ${previousRate ?? "—"} → ${newRate} (${source})`,
              },
            }),
          ]
        : []),
    ]);

    this.logger.log(
      `Org ${organizationId}: tasa ${previousRate ?? "—"} → ${newRate} (${source})`,
    );

    return {
      organizationId,
      updated: true,
      exchangeRate: newRate,
      previousRate,
      source,
      quote,
      rateUpdatedAt: now,
      rateUpdatedBy,
    };
  }

  async syncAllOrganizations(): Promise<{
    quote: DolarApiVenezuelaQuote;
    exchangeRate: number;
    source: string;
    results: ExchangeRateSyncResult[];
  }> {
    const quote = await this.dolarApi.fetchQuote();
    const exchangeRate = this.dolarApi.resolveUsdVesRate(quote);
    const source = this.dolarApi.getSourceLabel(quote);

    const systemActor = await this.prisma.user.findFirst({
      where: { isSuperAdmin: true, isActive: true },
      select: { id: true, email: true },
      orderBy: { id: "asc" },
    });

    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, exchangeRate: true, currencyCode: true },
    });

    const now = new Date();
    const results: ExchangeRateSyncResult[] = [];

    for (const org of orgs) {
      const previousRate = org.exchangeRate ?? null;
      const changed =
        previousRate == null || Math.abs(previousRate - exchangeRate) >= 0.0001;

      if (!changed) {
        results.push({
          organizationId: org.id,
          updated: false,
          exchangeRate: previousRate ?? exchangeRate,
          previousRate,
          source,
          quote,
          rateUpdatedAt: null,
          rateUpdatedBy: null,
        });
        continue;
      }

      await this.prisma.$transaction([
        this.prisma.organization.update({
          where: { id: org.id },
          data: {
            exchangeRate,
            rateUpdatedAt: now,
          },
        }),
        this.prisma.tasaHistorica.create({
          data: {
            organizationId: org.id,
            rate: exchangeRate,
            source: source.includes("Paralelo") ? "PARALELO" : "BCV",
            effectiveAt: now,
          },
        }),
        ...(systemActor
          ? [
              this.prisma.auditLog.create({
                data: {
                  organizationId: org.id,
                  userId: systemActor.id,
                  action: "CURRENCY_UPDATE",
                  entityType: "organization",
                  entityId: String(org.id),
                  oldValue:
                    previousRate != null
                      ? {
                          exchangeRate: previousRate,
                          currencyCode: org.currencyCode ?? "USD",
                        }
                      : undefined,
                  newValue: {
                    exchangeRate,
                    currencyCode: org.currencyCode ?? "USD",
                    source: "DolarApi",
                  },
                  actorEmail: "DolarApi BCV (automático)",
                  targetSummary: `Tasa BCV: ${previousRate ?? "—"} → ${exchangeRate} (${source})`,
                },
              }),
            ]
          : []),
      ]);

      results.push({
        organizationId: org.id,
        updated: true,
        exchangeRate,
        previousRate,
        source,
        quote,
        rateUpdatedAt: now,
        rateUpdatedBy: "DolarApi BCV (automático)",
      });
    }

    const updatedCount = results.filter((r) => r.updated).length;
    this.logger.log(
      `Sincronización BCV: ${updatedCount}/${orgs.length} orgs actualizadas → ${exchangeRate} (${source})`,
    );

    return { quote, exchangeRate, source, results };
  }
}
