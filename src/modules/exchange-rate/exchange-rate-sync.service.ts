import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DolarApiService } from "./dolar-api.service";
import type {
  DolarApiCurrency,
  DolarApiVenezuelaQuote,
} from "./dolar-api.types";

export interface ExchangeRateSyncResult {
  organizationId: number;
  updated: boolean;
  exchangeRate: number;
  previousRate: number | null;
  source: string;
  quote: DolarApiVenezuelaQuote;
  rateUpdatedAt: Date | null;
  rateUpdatedBy: string | null;
  euroExchangeRate: number;
  previousEuroRate: number | null;
  euroSource: string;
  euroQuote: DolarApiVenezuelaQuote;
  euroRateUpdatedAt: Date | null;
}

@Injectable()
export class ExchangeRateSyncService {
  private readonly logger = new Logger(ExchangeRateSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dolarApi: DolarApiService,
  ) {}

  async fetchQuotePreview(currency: DolarApiCurrency = "USD") {
    const quote = await this.dolarApi.fetchQuote(currency);
    return {
      currency,
      exchangeRate: this.dolarApi.resolveRate(currency, quote),
      source: this.dolarApi.getSourceLabel(currency, quote),
      quote,
      provider: "DolarApi.com",
      providerRepo: "https://github.com/enzonotario/esjs-dolar-api",
    };
  }

  async syncOrganization(
    organizationId: number,
    actorUserId?: number | null,
    providedQuotes?: {
      usd: DolarApiVenezuelaQuote;
      eur: DolarApiVenezuelaQuote;
    },
  ): Promise<ExchangeRateSyncResult> {
    const [quote, euroQuote] = providedQuotes
      ? [providedQuotes.usd, providedQuotes.eur]
      : await Promise.all([
          this.dolarApi.fetchQuote("USD"),
          this.dolarApi.fetchQuote("EUR"),
        ]);
    const newRate = this.dolarApi.resolveRate("USD", quote);
    const newEuroRate = this.dolarApi.resolveRate("EUR", euroQuote);
    const source = this.dolarApi.getSourceLabel("USD", quote);
    const euroSource = this.dolarApi.getSourceLabel("EUR", euroQuote);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true, euroExchangeRate: true, currencyCode: true },
    });

    const previousRate = org?.exchangeRate ?? null;
    const changed =
      previousRate == null || Math.abs(previousRate - newRate) >= 0.0001;
    const previousEuroRate = org?.euroExchangeRate ?? null;
    const euroChanged =
      previousEuroRate == null ||
      Math.abs(previousEuroRate - newEuroRate) >= 0.0001;

    if (!changed && !euroChanged) {
      return {
        organizationId,
        updated: false,
        exchangeRate: previousRate ?? newRate,
        previousRate,
        source,
        quote,
        rateUpdatedAt: null,
        rateUpdatedBy: null,
        euroExchangeRate: previousEuroRate ?? newEuroRate,
        previousEuroRate,
        euroSource,
        euroQuote,
        euroRateUpdatedAt: null,
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
          ...(changed && { exchangeRate: newRate, rateUpdatedAt: now }),
          ...(euroChanged && {
            euroExchangeRate: newEuroRate,
            euroRateUpdatedAt: now,
          }),
        },
      }),
      ...(changed
        ? [
            this.prisma.tasaHistorica.create({
              data: {
                organizationId,
                rate: newRate,
                source: source.includes("Paralelo") ? "PARALELO" : "BCV",
                effectiveAt: now,
              },
            }),
          ]
        : []),
      ...(euroChanged
        ? [
            this.prisma.tasaEuroHistorica.create({
              data: {
                organizationId,
                rate: newEuroRate,
                source: "BCV_EUR",
                effectiveAt: now,
              },
            }),
          ]
        : []),
      ...(actorUserId
        ? changed || euroChanged
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
                        euroExchangeRate: previousEuroRate,
                        currencyCode: org?.currencyCode ?? "USD",
                      }
                    : undefined,
                newValue: {
                  ...(changed && { exchangeRate: newRate }),
                  ...(euroChanged && { euroExchangeRate: newEuroRate }),
                  currencyCode: org?.currencyCode ?? "USD",
                  source: "DolarApi",
                },
                actorEmail: rateUpdatedBy,
                targetSummary: `Tasas: USD ${previousRate ?? "—"} → ${newRate}; EUR ${previousEuroRate ?? "—"} → ${newEuroRate}`,
              },
            }),
          ]
          : []
        : []),
    ]);

    this.logger.log(
      `Org ${organizationId}: USD ${previousRate ?? "—"} → ${newRate}; EUR ${previousEuroRate ?? "—"} → ${newEuroRate}`,
    );

    return {
      organizationId,
      updated: changed || euroChanged,
      exchangeRate: newRate,
      previousRate,
      source,
      quote,
      rateUpdatedAt: changed ? now : null,
      rateUpdatedBy: changed ? rateUpdatedBy : null,
      euroExchangeRate: newEuroRate,
      previousEuroRate,
      euroSource,
      euroQuote,
      euroRateUpdatedAt: euroChanged ? now : null,
    };
  }

  async syncAllOrganizations(): Promise<{
    quote: DolarApiVenezuelaQuote;
    exchangeRate: number;
    source: string;
    euroQuote: DolarApiVenezuelaQuote;
    euroExchangeRate: number;
    euroSource: string;
    results: ExchangeRateSyncResult[];
  }> {
    const [quote, euroQuote] = await Promise.all([
      this.dolarApi.fetchQuote("USD"),
      this.dolarApi.fetchQuote("EUR"),
    ]);
    const exchangeRate = this.dolarApi.resolveRate("USD", quote);
    const euroExchangeRate = this.dolarApi.resolveRate("EUR", euroQuote);
    const source = this.dolarApi.getSourceLabel("USD", quote);
    const euroSource = this.dolarApi.getSourceLabel("EUR", euroQuote);

    const systemActor = await this.prisma.user.findFirst({
      where: { isSuperAdmin: true, isActive: true },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const results: ExchangeRateSyncResult[] = [];

    for (const org of orgs) {
      results.push(
        await this.syncOrganization(org.id, systemActor?.id ?? null, {
          usd: quote,
          eur: euroQuote,
        }),
      );
    }

    const updatedCount = results.filter((result) => result.updated).length;
    this.logger.log(
      `Sincronización BCV: ${updatedCount}/${orgs.length} orgs actualizadas → USD ${exchangeRate}; EUR ${euroExchangeRate}`,
    );
    return {
      quote,
      exchangeRate,
      source,
      euroQuote,
      euroExchangeRate,
      euroSource,
      results,
    };
  }
}
