/**
 * Remediación post-apply Plan B — SUPERSEDE huérfanos + totalAmount=headerNet.
 *
 * Uso:
 *   pnpm exec tsx scripts/reconcile-sales-fastreport-planb-remediate.ts
 *   pnpm exec tsx scripts/reconcile-sales-fastreport-planb-remediate.ts --dry-run
 *   pnpm exec tsx scripts/reconcile-sales-fastreport-planb-remediate.ts --apply
 *
 * Sin InventoryMovement. Sin DELETE físico.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import {
  PLANB_SOURCE_HASH,
  PLANB_ORG_ID,
} from "../src/modules/sales-reconcile/planb-reconcile.planner";
import {
  buildPlanBRemediation,
  type RemediateSourceFac,
} from "../src/modules/sales-reconcile/planb-remediate.planner";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const TASK002A =
  process.env.PLANB_TASK002A_DIR ??
  path.join(
    process.env.HOME ?? "",
    ".local/share/marfyl-audit/task002a-b823b2f967c5",
  );

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply;
  return { apply, dryRun };
}

function readNdjson<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function loadFacs(): RemediateSourceFac[] {
  const facsRaw = readNdjson<Record<string, unknown>>(
    path.join(TASK002A, "fac_manifest.ndjson"),
  );
  return facsRaw
    .filter((f) => f.documentType === "FAC")
    .map((f) => ({
      documentNumber: String(f.documentNumber),
      headerNet: String(
        f.headerNet ?? (f.header as { net?: string })?.net ?? "0",
      ),
    }));
}

async function loadSnapshot(prisma: PrismaClient, facs: RemediateSourceFac[]) {
  const legacyKeys = facs.map((f) => `FAC-${f.documentNumber}`);
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: PLANB_ORG_ID,
      legacyImportKey: { in: legacyKeys },
    },
    select: {
      id: true,
      legacyImportKey: true,
      totalAmount: true,
      deletedAt: true,
    },
  });

  const invoiceIds = invoices.map((i) => i.id);
  const items =
    invoiceIds.length === 0
      ? []
      : await prisma.invoiceItem.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: {
            id: true,
            invoiceId: true,
            sourceHash: true,
            lineageStatus: true,
          },
        });

  return {
    invoices: invoices.map((i) => ({
      id: i.id,
      legacyImportKey: i.legacyImportKey,
      totalAmount: i.totalAmount.toString(),
      deletedAt: i.deletedAt,
    })),
    items: items.map((it) => ({
      id: it.id,
      invoiceId: it.invoiceId,
      sourceHash: it.sourceHash,
      lineageStatus: String(it.lineageStatus),
    })),
  };
}

async function applyRemediation(
  prisma: PrismaClient,
  plan: ReturnType<typeof buildPlanBRemediation>,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      if (plan.supersedeItemIds.length > 0) {
        // Chunks para evitar límites de parámetro
        const chunk = 500;
        for (let i = 0; i < plan.supersedeItemIds.length; i += chunk) {
          const ids = plan.supersedeItemIds.slice(i, i + chunk);
          await tx.invoiceItem.updateMany({
            where: {
              id: { in: ids },
              lineageStatus: "ACTIVE",
            },
            data: { lineageStatus: "SUPERSEDED" },
          });
        }
      }

      for (const u of plan.totalUpdates) {
        await tx.invoice.update({
          where: { id: u.invoiceId },
          data: { totalAmount: u.totalAmount },
        });
      }
    },
    { timeout: 600_000 },
  );
}

async function verifyPostApply(
  prisma: PrismaClient,
  facs: RemediateSourceFac[],
): Promise<void> {
  const legacyKeys = facs.map((f) => `FAC-${f.documentNumber}`);
  const invoices = await prisma.invoice.findMany({
    where: {
      organizationId: PLANB_ORG_ID,
      legacyImportKey: { in: legacyKeys },
      deletedAt: null,
    },
    select: { id: true, totalAmount: true },
  });
  const invoiceIds = invoices.map((i) => i.id);

  const [activeAgg, supersededCount, reconciledPlanB, orphanActive] =
    await Promise.all([
      prisma.invoiceItem.count({
        where: { invoiceId: { in: invoiceIds }, lineageStatus: "ACTIVE" },
      }),
      prisma.invoiceItem.count({
        where: { invoiceId: { in: invoiceIds }, lineageStatus: "SUPERSEDED" },
      }),
      prisma.invoiceItem.count({
        where: {
          invoiceId: { in: invoiceIds },
          lineageStatus: "ACTIVE",
          sourceHash: PLANB_SOURCE_HASH,
          recordClass: "RECONCILED_HISTORY",
        },
      }),
      prisma.invoiceItem.count({
        where: {
          invoiceId: { in: invoiceIds },
          lineageStatus: "ACTIVE",
          OR: [
            { sourceHash: null },
            { sourceHash: { not: PLANB_SOURCE_HASH } },
          ],
        },
      }),
    ]);

  const sumTotal = invoices.reduce((a, i) => a + Number(i.totalAmount), 0);
  const sourceKeys = new Set(
    readNdjson<Record<string, unknown>>(
      path.join(TASK002A, "line_manifest.ndjson"),
    )
      .filter((l) => l.documentType === "FAC")
      .map((l) => String(l.sourceLineKey)),
  );
  const dbKeys = await prisma.invoiceItem.findMany({
    where: {
      invoiceId: { in: invoiceIds },
      lineageStatus: "ACTIVE",
      sourceLineKey: { not: null },
    },
    select: { sourceLineKey: true },
  });
  const dbKeySet = new Set(
    dbKeys.map((k) => k.sourceLineKey).filter(Boolean) as string[],
  );
  let missingKeys = 0;
  for (const k of sourceKeys) {
    if (!dbKeySet.has(k)) missingKeys += 1;
  }

  console.log("\n--- Verificación post-apply ---");
  console.log(`FAC active lote: ${invoices.length}`);
  console.log(`ACTIVE items: ${activeAgg} (RECONCILED planB: ${reconciledPlanB})`);
  console.log(`SUPERSEDED items (lote): ${supersededCount}`);
  console.log(`ACTIVE huérfanos restantes: ${orphanActive}`);
  console.log(`SUM(totalAmount): ${sumTotal.toFixed(2)}`);
  console.log(
    `sourceLineKeys: ${sourceKeys.size - missingKeys}/${sourceKeys.size} (missing=${missingKeys})`,
  );
}

async function main() {
  const opts = parseArgs();
  console.log("=== Plan B REMEDIATE (orphans + headerNet) ===");
  console.log(`Mode: ${opts.apply ? "APPLY" : "DRY-RUN (default)"}`);
  console.log(`Source hash: ${PLANB_SOURCE_HASH}`);
  console.log(`task002a: ${TASK002A}`);

  if (!fs.existsSync(TASK002A)) {
    throw new Error(`No existe TASK-002A dir: ${TASK002A}`);
  }

  const facs = loadFacs();
  console.log(`FAC fuente: ${facs.length}`);

  const prisma = new PrismaClient();
  try {
    const snap = await loadSnapshot(prisma, facs);
    console.log(
      `DB: ${snap.invoices.length} invoices del lote, ${snap.items.length} items (todas lineage)`,
    );

    const plan = buildPlanBRemediation({
      sourceHash: PLANB_SOURCE_HASH,
      facs,
      existingInvoices: snap.invoices,
      existingItems: snap.items,
    });

    console.log("\n--- Contadores remediación ---");
    console.log(JSON.stringify(plan.counters, null, 2));
    console.log(
      `Esperado ≈: orphansToSupersede≈245, totalsToFix≈183, netAfter=10399.18`,
    );
    console.log(`actions: ${plan.actions.length}`);
    console.log(
      `SUPERSEDE ids: ${plan.supersedeItemIds.length}; UPDATE totals: ${plan.totalUpdates.length}`,
    );

    if (opts.dryRun) {
      console.log("\nDRY-RUN complete. No se escribió nada.");
      process.exit(0);
    }

    console.log(
      "\n>>> APPLY remediación: SUPERSEDE orphans + UPDATE totalAmount (sin InventoryMovement)...",
    );
    await applyRemediation(prisma, plan);
    console.log("APPLY complete.");
    await verifyPostApply(prisma, facs);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
