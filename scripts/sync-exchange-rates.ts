/**
 * Sincroniza tasa BCV para todas las organizaciones vía DolarApi.
 * Uso: pnpm sync:exchange-rates
 *
 * API: https://ve.dolarapi.com (https://github.com/enzonotario/esjs-dolar-api)
 */
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

async function fetchQuote() {
  const base =
    process.env.DOLAR_API_VE_BASE_URL?.trim() || "https://ve.dolarapi.com";
  const kind =
    (process.env.DOLAR_API_RATE_KIND || "oficial").toLowerCase() === "paralelo"
      ? "paralelo"
      : "oficial";
  const res = await fetch(`${base}/v1/dolares/${kind}`, {
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
    const quote = await fetchQuote();
    const rate = Math.round(
      (quote.promedio ?? quote.venta ?? quote.compra ?? 0) * 10_000,
    ) / 10_000;
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Cotización inválida desde DolarApi");
    }

    const orgs = await prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, nombre: true, exchangeRate: true },
    });

    const now = new Date();
    let updated = 0;

    for (const org of orgs) {
      if (Math.abs((org.exchangeRate ?? 0) - rate) < 0.0001) continue;
      await prisma.$transaction([
        prisma.organization.update({
          where: { id: org.id },
          data: { exchangeRate: rate, rateUpdatedAt: now },
        }),
        prisma.tasaHistorica.create({
          data: {
            organizationId: org.id,
            rate,
            source: "BCV",
            effectiveAt: now,
          },
        }),
      ]);
      console.log(
        `✅ ${org.nombre}: ${org.exchangeRate ?? "—"} → ${rate} Bs/USD (Dólar BCV)`,
      );
      updated += 1;
    }

    console.log(
      `\n🎉 Dólar BCV ${quote.nombre}: ${rate} Bs/USD (${quote.fechaActualizacion})`,
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
