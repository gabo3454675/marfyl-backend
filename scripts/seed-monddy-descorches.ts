/**
 * Seed de tarifas de descorche Monddy en STAGING (productos isService).
 *
 * Uso (NO ejecutar sin STAGING_DB confirmado — normalmente TASK-007):
 *   DATABASE_URL=<staging> ./node_modules/.bin/tsx scripts/seed-monddy-descorches.ts
 *
 * Guardas:
 *   - Abort si DATABASE_URL/host contiene ep-super-art (prod)
 *   - Abort si no contiene ep-curly-star (staging)
 *
 * Productos:
 *   - DESCORCHE-30 ($30) — crear/upsert
 *   - 0000112 DESCORCHE VIP ($20) — reutilizar si salePrice=20; si no, crear DESCORCHE-20
 *   - DESCORCHE-15 ($15) — crear/upsert
 *   - DESCORCHE-10 ($10) — genérico
 *   - 0000125 DESCORCHE VINO ($10) — mapeo vinos; reutilizar si precio=10
 *
 * Contrato: isService=true, isBundle=false, salePrice=tarifa, costPrice=0, stock=0.
 * BOM v1: vacío (sin botella). Acompañamientos opcionales después con roles explícitos.
 * Beers OUT.
 *
 * Mapeo combo → descorche (anotación para TASK-004; no auto-agrega línea):
 *   COMBO-01 → DESCORCHE-30 ($30)
 *   COMBO-02..04 → VIP 0000112 / DESCORCHE-20 ($20)
 *   COMBO-05..07 → DESCORCHE-15 ($15)
 *   COMBO-08 → DESCORCHE-10 ($10)
 *   COMBO-12..13 → VINO 0000125 ($10)
 *   else → none
 *
 * Ver también: scripts/seed-monddy-liquor-combos.ts (combos isBundle; descorche NO en BOM).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  DESCORCHE_TARIFFS,
  EMPTY_DESCORCHE_BOM,
  EXISTING_DESCORCHE_SKUS,
  VIP_FALLBACK_SKU,
  allComboDescorcheHints,
  resolveReusableSku,
  type DescorcheTariffDef,
} from "../src/common/monddy/descorche-catalog";

const STAGING_HOST_MARKER = "ep-curly-star";
const PROD_HOST_MARKER = "ep-super-art";
const ORG_SLUG = "monddy";

function assertStagingDatabaseUrl(databaseUrl: string | undefined): void {
  const url = (databaseUrl ?? "").toLowerCase();
  if (url.includes(PROD_HOST_MARKER)) {
    throw new Error(
      `[seed-monddy-descorches] Abortado: DATABASE_URL apunta a producción (${PROD_HOST_MARKER}).`,
    );
  }
  if (!url.includes(STAGING_HOST_MARKER)) {
    throw new Error(
      `[seed-monddy-descorches] Abortado: DATABASE_URL debe contener ${STAGING_HOST_MARKER} (staging).`,
    );
  }
}

async function findBySkuOrBarcode(
  prisma: PrismaClient,
  organizationId: number,
  sku: string,
): Promise<{
  id: number;
  sku: string | null;
  name: string;
  salePrice: { toString(): string } | number;
  isExempt: boolean;
} | null> {
  return prisma.product.findFirst({
    where: {
      organizationId,
      OR: [{ sku }, { barcode: sku }],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      salePrice: true,
      isExempt: true,
    },
  });
}

type UpsertPlan = {
  def: DescorcheTariffDef;
  effectiveSku: string;
  effectiveName: string;
  resolveReason: string;
};

function buildUpsertPlans(
  existingVipPrice: number | null,
  existingVinoPrice: number | null,
): UpsertPlan[] {
  const plans: UpsertPlan[] = [];

  for (const def of DESCORCHE_TARIFFS) {
    if (def.sku === EXISTING_DESCORCHE_SKUS.vip && def.reuseIfPriceMatches) {
      const resolved = resolveReusableSku({
        preferredSku: def.sku,
        fallbackSku: def.fallbackSku ?? VIP_FALLBACK_SKU,
        targetPrice: def.salePrice,
        existingSalePrice: existingVipPrice,
      });
      plans.push({
        def,
        effectiveSku: resolved.sku,
        effectiveName:
          resolved.sku === VIP_FALLBACK_SKU ? "Descorche $20" : def.name,
        resolveReason: resolved.reason,
      });
      continue;
    }

    if (def.sku === EXISTING_DESCORCHE_SKUS.vino && def.reuseIfPriceMatches) {
      const resolved = resolveReusableSku({
        preferredSku: def.sku,
        fallbackSku: def.fallbackSku ?? "DESCORCHE-10",
        targetPrice: def.salePrice,
        existingSalePrice: existingVinoPrice,
      });
      // Si VINO price mismatch: no tocar ni duplicar DESCORCHE-10 (ya cubre $10).
      if (resolved.reason === "fallback_price_mismatch") {
        continue;
      }
      plans.push({
        def,
        effectiveSku: resolved.sku,
        effectiveName: def.name,
        resolveReason: resolved.reason,
      });
      continue;
    }

    plans.push({
      def,
      effectiveSku: def.sku,
      effectiveName: def.name,
      resolveReason: "upsert_canonical",
    });
  }

  return plans;
}

async function main() {
  assertStagingDatabaseUrl(process.env.DATABASE_URL);

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({
      where: { slug: ORG_SLUG },
      select: { id: true, nombre: true, slug: true },
    });
    if (!org) {
      throw new Error(`Organización "${ORG_SLUG}" no encontrada`);
    }

    const sample = await prisma.product.findFirst({
      where: { organizationId: org.id },
      select: { companyId: true },
      orderBy: { id: "asc" },
    });
    if (!sample) {
      throw new Error(`Org ${ORG_SLUG} sin productos (no hay companyId)`);
    }
    const companyId = sample.companyId;

    const vipExisting = await findBySkuOrBarcode(
      prisma,
      org.id,
      EXISTING_DESCORCHE_SKUS.vip,
    );
    const vinoExisting = await findBySkuOrBarcode(
      prisma,
      org.id,
      EXISTING_DESCORCHE_SKUS.vino,
    );

    const existingVipPrice = vipExisting
      ? Number(vipExisting.salePrice)
      : null;
    const existingVinoPrice = vinoExisting
      ? Number(vinoExisting.salePrice)
      : null;

    if (
      existingVinoPrice != null &&
      existingVinoPrice !== 10
    ) {
      console.warn(
        `[seed-monddy-descorches] SKIP upsert VINO ${EXISTING_DESCORCHE_SKUS.vino}: salePrice=${existingVinoPrice} ≠ 10; COMBO-12/13 pueden usar DESCORCHE-10.`,
      );
    }

    const plans = buildUpsertPlans(existingVipPrice, existingVinoPrice);

    // Evitar doble upsert del mismo SKU si algún fallback colisiona
    const seen = new Set<string>();
    const uniquePlans = plans.filter((p) => {
      if (seen.has(p.effectiveSku)) return false;
      seen.add(p.effectiveSku);
      return true;
    });

    const vipPlan = uniquePlans.find(
      (p) =>
        p.def.sku === EXISTING_DESCORCHE_SKUS.vip ||
        p.effectiveSku === VIP_FALLBACK_SKU,
    );
    const vipResolvedSku = vipPlan?.effectiveSku ?? EXISTING_DESCORCHE_SKUS.vip;

    console.log(`Org: ${org.nombre} (id=${org.id}, slug=${org.slug})`);
    console.log(`companyId=${companyId}`);
    console.log(`VIP resolve: price=${existingVipPrice} → ${vipResolvedSku}`);
    console.log(
      `VINO existing price=${existingVinoPrice} (reuse if === 10)`,
    );

    const results: {
      sku: string;
      id: number;
      action: "created" | "updated" | "skipped";
      name: string;
      salePrice: number;
      isService: boolean;
      isExempt: boolean;
      reason: string;
    }[] = [];

    for (const plan of uniquePlans) {
      const existing = await findBySkuOrBarcode(
        prisma,
        org.id,
        plan.effectiveSku,
      );

      const isExempt = existing
        ? existing.isExempt
        : plan.def.defaultIsExempt;

      const data = {
        name: plan.effectiveName,
        salePrice: plan.def.salePrice,
        costPrice: 0,
        stock: 0,
        isService: true,
        isBundle: false,
        bundleComponents: EMPTY_DESCORCHE_BOM,
        isActive: true,
        isExempt,
        salePriceCurrency: "USD" as const,
        minStock: 0,
      };

      if (existing) {
        const updated = await prisma.product.update({
          where: { id: existing.id },
          data,
        });
        results.push({
          sku: plan.effectiveSku,
          id: updated.id,
          action: "updated",
          name: updated.name,
          salePrice: Number(updated.salePrice),
          isService: updated.isService,
          isExempt: updated.isExempt,
          reason: plan.resolveReason,
        });
      } else {
        const created = await prisma.product.create({
          data: {
            companyId,
            organizationId: org.id,
            sku: plan.effectiveSku,
            ...data,
          },
        });
        results.push({
          sku: plan.effectiveSku,
          id: created.id,
          action: "created",
          name: created.name,
          salePrice: Number(created.salePrice),
          isService: created.isService,
          isExempt: created.isExempt,
          reason: plan.resolveReason,
        });
      }
    }

    console.log("\n=== Resumen descorches Monddy ===");
    for (const r of results) {
      console.log(
        `${r.action.toUpperCase()} ${r.sku} id=${r.id} "${r.name}" $${r.salePrice} isService=${r.isService} isExempt=${r.isExempt} (${r.reason})`,
      );
    }

    console.log("\n=== Mapeo combo → descorche (TASK-004) ===");
    for (const hint of allComboDescorcheHints({ vipResolvedSku })) {
      if (hint.tariffUsd == null) {
        console.log(`${hint.comboSku} → (none)`);
      } else {
        console.log(
          `${hint.comboSku} → $${hint.tariffUsd} ${hint.suggestedDescorcheSku}`,
        );
      }
    }

    const created = results.filter((r) => r.action === "created").length;
    const updated = results.filter((r) => r.action === "updated").length;
    console.log(
      `\nDone: ${created} created, ${updated} updated, total=${results.length}. BOM v1=empty.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
