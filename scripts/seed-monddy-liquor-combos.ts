/**
 * Seed de 16 combos de licores Monddy en STAGING (FULL BOM: botella + vasos + hielo + mixers).
 *
 * Uso (NO ejecutar sin STAGING_DB confirmado — normalmente TASK-007):
 *   DATABASE_URL=<staging> ./node_modules/.bin/tsx scripts/seed-monddy-liquor-combos.ts
 *
 * Guardas:
 *   - Abort si DATABASE_URL/host contiene ep-super-art (prod)
 *   - Abort si no contiene ep-curly-star (staging)
 *
 * Notas BOM (documentación operativa):
 *   - Vasos: SKU 7590200270066 VASOS PLASTICOS LOS LLANOS N° 27 × 4 por combo
 *   - Media hielo: SKU 00001256 MEDIA BOLSA DE HIELO × 1
 *   - Descorche NO va en BOM (tarifas isService: scripts/seed-monddy-descorches.ts)
 *   - suggestedDescorcheSku se anota en product.description vía resolveComboDescorcheHint
 *   - COMBO-13: Rosario Merlot 7804436702537; alt. Misiones 7808704700140 si falta
 *   - salePrice = Ref USD; costPrice = 0; stock = 0; isBundle true; isService false
 *   - Beers / tobos OUT
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { parseBomLines } from "../src/common/bom/bundle-bom";
import {
  LIQUOR_COMBOS,
  allComboComponentSkus,
  comboBomSkuLines,
  formatComboDescorcheDescription,
  liquorComboMatrix,
} from "../src/common/monddy/liquor-combo-catalog";

const STAGING_HOST_MARKER = "ep-curly-star";
const PROD_HOST_MARKER = "ep-super-art";
const ORG_SLUG = "monddy";

function assertStagingDatabaseUrl(databaseUrl: string | undefined): void {
  const url = (databaseUrl ?? "").toLowerCase();
  if (url.includes(PROD_HOST_MARKER)) {
    throw new Error(
      `[seed-monddy-liquor-combos] Abortado: DATABASE_URL apunta a producción (${PROD_HOST_MARKER}).`,
    );
  }
  if (!url.includes(STAGING_HOST_MARKER)) {
    throw new Error(
      `[seed-monddy-liquor-combos] Abortado: DATABASE_URL debe contener ${STAGING_HOST_MARKER} (staging).`,
    );
  }
}

async function resolveSkuMap(
  prisma: PrismaClient,
  organizationId: number,
  skus: string[],
): Promise<Map<string, { id: number; name: string; sku: string | null }>> {
  const unique = [...new Set(skus)];
  const products = await prisma.product.findMany({
    where: {
      organizationId,
      OR: [{ sku: { in: unique } }, { barcode: { in: unique } }],
    },
    select: { id: true, name: true, sku: true, barcode: true },
  });

  const byKey = new Map<
    string,
    { id: number; name: string; sku: string | null }
  >();
  for (const p of products) {
    const entry = { id: p.id, name: p.name, sku: p.sku };
    if (p.sku && unique.includes(p.sku)) byKey.set(p.sku, entry);
    if (p.barcode && unique.includes(p.barcode) && !byKey.has(p.barcode)) {
      byKey.set(p.barcode, entry);
    }
  }
  return byKey;
}

function pickBottleSku(
  combo: (typeof LIQUOR_COMBOS)[number],
  skuMap: Map<string, { id: number; name: string; sku: string | null }>,
): string {
  if (skuMap.has(combo.bottleSku)) return combo.bottleSku;
  if (combo.alternateBottleSku && skuMap.has(combo.alternateBottleSku)) {
    console.warn(
      `[seed-monddy-liquor-combos] ${combo.sku}: usando alternateBottleSku ${combo.alternateBottleSku} (faltó ${combo.bottleSku})`,
    );
    return combo.alternateBottleSku;
  }
  throw new Error(
    `[seed-monddy-liquor-combos] Botella faltante para ${combo.sku}: ${combo.bottleSku}` +
      (combo.alternateBottleSku ? ` (alt ${combo.alternateBottleSku})` : ""),
  );
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

    console.log(`Org: ${org.nombre} (id=${org.id}, slug=${org.slug})`);
    console.log(`companyId=${companyId}`);
    console.log("Resolviendo SKUs de componentes…");

    const skuMap = await resolveSkuMap(
      prisma,
      org.id,
      allComboComponentSkus(),
    );

    const requiredShared = comboBomSkuLines(LIQUOR_COMBOS[0]!)
      .filter((l) => l.role === "cups" || l.role === "ice")
      .map((l) => l.sku);
    const missingShared = requiredShared.filter((s) => !skuMap.has(s));
    const missingMixers = [
      ...new Set(LIQUOR_COMBOS.flatMap((c) => c.extras.map((e) => e.sku))),
    ].filter((s) => !skuMap.has(s));
    if (missingShared.length > 0 || missingMixers.length > 0) {
      throw new Error(
        `[seed-monddy-liquor-combos] SKUs faltantes en org monddy:\n` +
          [...missingShared, ...missingMixers]
            .map((s) => `  - ${s}`)
            .join("\n"),
      );
    }

    const results: {
      sku: string;
      id: number;
      action: "created" | "updated";
      recipeLines: number;
      name: string;
      salePrice: number;
      description: string | null;
      bottleSku: string;
    }[] = [];

    for (const combo of LIQUOR_COMBOS) {
      const bottleSku = pickBottleSku(combo, skuMap);
      const bomSkuLines = comboBomSkuLines(combo, {
        bottleSkuOverride: bottleSku,
      });
      const bomRaw = bomSkuLines.map((line) => ({
        productId: skuMap.get(line.sku)!.id,
        quantity: line.quantity,
      }));
      const bom = parseBomLines(bomRaw);
      const description = formatComboDescorcheDescription(combo.sku);

      const existing = await prisma.product.findFirst({
        where: { organizationId: org.id, sku: combo.sku },
        select: { id: true },
      });

      const data = {
        name: combo.name,
        salePrice: combo.salePrice,
        costPrice: 0,
        isBundle: true,
        isService: false,
        stock: 0,
        bundleComponents: bom,
        isActive: true,
        salePriceCurrency: "USD" as const,
        description,
      };

      if (existing) {
        const updated = await prisma.product.update({
          where: { id: existing.id },
          data,
        });
        results.push({
          sku: combo.sku,
          id: updated.id,
          action: "updated",
          recipeLines: bom.length,
          name: updated.name,
          salePrice: Number(updated.salePrice),
          description: updated.description,
          bottleSku,
        });
      } else {
        const created = await prisma.product.create({
          data: {
            companyId,
            organizationId: org.id,
            sku: combo.sku,
            minStock: 0,
            ...data,
          },
        });
        results.push({
          sku: combo.sku,
          id: created.id,
          action: "created",
          recipeLines: bom.length,
          name: created.name,
          salePrice: Number(created.salePrice),
          description: created.description,
          bottleSku,
        });
      }
    }

    console.log("\n=== Matriz combos Monddy (SKU / Ref / descorche hint) ===");
    for (const row of liquorComboMatrix()) {
      const hint = row.descorcheHint
        ? `$${row.descorcheHint.tariffUsd} ${row.descorcheHint.suggestedDescorcheSku}`
        : "(none)";
      console.log(
        `${row.sku} $${row.salePrice} "${row.name}" descorche=${hint} BOM=${row.bomSkus.length}`,
      );
    }

    console.log("\n=== Resumen upsert ===");
    for (const r of results) {
      console.log(
        `${r.action.toUpperCase()} ${r.sku} id=${r.id} "${r.name}" $${r.salePrice} bottle=${r.bottleSku} BOM_lines=${r.recipeLines} desc=${r.description ?? "(none)"}`,
      );
    }

    const comboIds = results.map((r) => r.id);
    const products = await prisma.product.findMany({
      where: { organizationId: org.id, id: { in: comboIds } },
      select: {
        id: true,
        sku: true,
        name: true,
        isBundle: true,
        isService: true,
        bundleComponents: true,
        salePrice: true,
        description: true,
      },
    });
    const byId = await prisma.product.findMany({
      where: { organizationId: org.id },
      select: {
        id: true,
        name: true,
        sku: true,
        isActive: true,
        isService: true,
        isBundle: true,
      },
    });
    const childById = new Map(byId.map((p) => [p.id, p]));

    console.log("\n=== Verificación BOM (estilo getBomOverview) ===");
    let allOk = true;
    for (const p of products) {
      const lines = parseBomLines(p.bundleComponents);
      const resolved = lines.map((l) => {
        const child = childById.get(l.productId);
        return {
          ...l,
          name: child?.name ?? `#${l.productId}`,
          missing: !child,
          inactive: child ? !child.isActive : false,
          isService: child?.isService === true,
          isBundle: child?.isBundle === true,
        };
      });
      const recipeOk =
        p.isBundle === true &&
        p.isService === false &&
        lines.length > 0 &&
        resolved.every(
          (l) => !l.missing && !l.inactive && !l.isService && !l.isBundle,
        );
      if (!recipeOk) allOk = false;
      console.log(
        `${p.sku} id=${p.id} recipeOk=${recipeOk} lines=${lines.length} → ${resolved
          .map((l) => `${l.name}×${l.quantity}`)
          .join(", ")}`,
      );
    }

    const created = results.filter((r) => r.action === "created").length;
    const updated = results.filter((r) => r.action === "updated").length;
    console.log(
      `\nDone: ${created} created, ${updated} updated, total=${results.length}, allRecipeOk=${allOk}`,
    );
    if (!allOk) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
