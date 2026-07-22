/**
 * Sincroniza tasas BCV USD/VES y EUR/VES para todas las organizaciones vía DolarApi.
 * Uso: pnpm sync:exchange-rates
 *
 * API: https://ve.dolarapi.com (https://github.com/enzonotario/esjs-dolar-api)
 */
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

async function fetchQuote(currency: "USD" | "EUR") {
  const base =
    process.env.DOLAR_API_VE_BASE_URL?.trim() || "https://ve.dolarapi.com";
  const kind =
    (process.env.DOLAR_API_RATE_KIND || "oficial").toLowerCase() === "paralelo"
      ? "paralelo"
      : "oficial";
  const endpoint =
    currency === "USD" ? `/v1/dolares/${kind}` : "/v1/euros/oficial";
  const res = await fetch(`${base}${endpoint}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`DolarApi HTTP ${res.status}`);
  return res.json() as Promise<{
    nombre: string;
    promedio: number | null;
    venta: number | null;
    compra: number | null;
    fechaActualizacion: string;
  }>;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const [quote, euroQuote] = await Promise.all([
      fetchQuote("USD"),
      fetchQuote("EUR"),
    ]);
    const resolveRate = (candidate: typeof quote) => Math.round(
      (candidate.promedio ?? candidate.venta ?? candidate.compra ?? 0) * 10_000,
    ) / 10_000;
    const rate = resolveRate(quote);
    const euroRate = resolveRate(euroQuote);
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(euroRate) || euroRate <= 0) {
      throw new Error("Cotización USD o EUR inválida desde DolarApi");
    }

    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, nombre: true, exchangeRate: true, euroExchangeRate: true },
    });

    const now = new Date();
    let updated = 0;

    for (const org of orgs) {
      const usdChanged = Math.abs((org.exchangeRate ?? 0) - rate) >= 0.0001;
      const euroChanged = Math.abs((org.euroExchangeRate ?? 0) - euroRate) >= 0.0001;
      if (!usdChanged && !euroChanged) continue;
      await prisma.$transaction([
        prisma.organization.update({
          where: { id: org.id },
          data: {
            ...(usdChanged && { exchangeRate: rate, rateUpdatedAt: now }),
            ...(euroChanged && { euroExchangeRate: euroRate, euroRateUpdatedAt: now }),
          },
        }),
        ...(usdChanged
          ? [prisma.tasaHistorica.create({
              data: { organizationId: org.id, rate, source: "BCV", effectiveAt: now },
            })]
          : []),
        ...(euroChanged
          ? [prisma.tasaEuroHistorica.create({
              data: { organizationId: org.id, rate: euroRate, source: "BCV_EUR", effectiveAt: now },
            })]
          : []),
      ]);
      console.log(
        `✅ ${org.nombre}: USD ${org.exchangeRate ?? "—"} → ${rate}; EUR ${org.euroExchangeRate ?? "—"} → ${euroRate} Bs`,
      );
      updated += 1;
    }

    console.log(
      `\n🎉 USD ${quote.nombre}: ${rate} Bs/USD · EUR ${euroQuote.nombre}: ${euroRate} Bs/EUR`,
    );
    console.log(`   ${updated}/${orgs.length} organizaciones actualizadas`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
