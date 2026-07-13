/**
 * Importa ventas históricas FastReport (Monddy) desde archivos .xls XML.
 *
 * Uso:
 *   pnpm import:monddy-sales --preview
 *   pnpm import:monddy-sales --complete
 *   pnpm import:monddy-sales --confirm --batch-id <id> [--allow-warnings]
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { SalesImportService } from "../src/modules/sales-import/sales-import.service";
import type { PrismaService } from "../src/common/prisma/prisma.service";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const DEFAULT_FILES = [
  "/home/gabdev/Descargas/Reporte General de Ventas 08_17_2026.xls",
  "/home/gabdev/Descargas/Reporte General de Ventas 09_17_2026.xls",
  "/home/gabdev/Descargas/Reporte General  de Productos Vendidos fin de semana 10 al 12.xls",
];

const MONDDY_ORG_ID = 2;

function parseArgs() {
  const args = process.argv.slice(2);
  const preview = args.includes("--preview");
  const confirm = args.includes("--confirm");
  const autoConfirm = args.includes("--auto-confirm");
  const complete = args.includes("--complete");
  const provisionMissing = args.includes("--provision-missing") || complete;
  const allowWarnings = args.includes("--allow-warnings") || complete;
  const batchIdx = args.indexOf("--batch-id");
  const batchId = batchIdx >= 0 ? args[batchIdx + 1] : undefined;
  const orgIdx = args.indexOf("--org-id");
  const orgId = orgIdx >= 0 ? Number(args[orgIdx + 1]) : MONDDY_ORG_ID;
  const fileArgs = args.filter(
    (a) => !a.startsWith("--") && !a.endsWith(".ts") && a.includes(".xls"),
  );
  return {
    preview,
    confirm,
    autoConfirm,
    complete,
    provisionMissing,
    allowWarnings,
    batchId,
    orgId,
    files: fileArgs.length > 0 ? fileArgs : DEFAULT_FILES,
  };
}

async function resolveSellerId(prisma: PrismaClient, orgId: number) {
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { userId: true },
    orderBy: { id: "asc" },
  });
  if (!member) throw new Error(`Sin miembros activos en org ${orgId}`);
  return member.userId;
}

async function main() {
  const opts = parseArgs();
  if (!opts.preview && !opts.confirm && !opts.autoConfirm && !opts.complete) {
    console.error(
      "Indique --preview, --complete, --auto-confirm o --confirm --batch-id <id>\n" +
        "Ejemplo: pnpm import:monddy-sales --complete",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const service = new SalesImportService(prisma as unknown as PrismaService);

  try {
    const org = await prisma.organization.findFirst({
      where: { id: opts.orgId, deletedAt: null },
      select: { id: true, nombre: true, slug: true },
    });
    if (!org) throw new Error(`Organización ${opts.orgId} no encontrada`);
    console.log(`Organización: ${org.nombre} (${org.slug}, id=${org.id})`);

    if (opts.preview || opts.autoConfirm || opts.complete) {
      console.log(`\nArchivos (${opts.files.length}):`);
      for (const f of opts.files) console.log(`  - ${f}`);

      if (opts.provisionMissing) {
        console.log("\n>>> Creando productos faltantes en catálogo...");
        const provision = await service.provisionMissingProductsFromPaths({
          organizationId: opts.orgId,
          filePaths: opts.files,
        });
        console.log(
          `Productos creados: ${provision.created} (catálogo Excel: ${provision.skipped + provision.created})`,
        );
        if (provision.created > 0 && provision.products.length <= 20) {
          for (const sku of provision.products) console.log(`  + ${sku}`);
        } else if (provision.created > 0) {
          console.log(`  (primeros 10: ${provision.products.slice(0, 10).join(", ")})`);
        }
      }

      const result = await service.previewFromPaths({
        organizationId: opts.orgId,
        filePaths: opts.files,
      });

      console.log("\n=== RESUMEN PREVIEW ===");
      console.log(`Batch ID: ${result.batchId}`);
      console.log(`Facturas: ${result.summary.invoices}`);
      console.log(`Líneas:   ${result.summary.lines}`);
      console.log(`Listas:   ${result.summary.ready}`);
      console.log(`Warnings: ${result.summary.warnings}`);
      console.log(`Errores:  ${result.summary.errors}`);
      console.log(`Ya import: ${result.summary.alreadyImported}`);

      const errors = result.invoices.filter((i) => i.status === "error");
      if (errors.length > 0) {
        console.log("\n--- Errores (primeros 15) ---");
        for (const inv of errors.slice(0, 15)) {
          console.log(
            `${inv.legacyKey} (${inv.saleDate}): ${inv.issues.join("; ")}`,
          );
        }
      }

      const warnings = result.invoices.filter((i) => i.status === "warning");
      if (warnings.length > 0) {
        console.log("\n--- Warnings (primeros 10) ---");
        for (const inv of warnings.slice(0, 10)) {
          console.log(
            `${inv.legacyKey}: Excel=${inv.excelTotal} Calc=${inv.computedTotal} — ${inv.issues.join("; ")}`,
          );
        }
      }

      console.log(
        `\nPara importar:\n  pnpm import:monddy-sales --confirm --batch-id ${result.batchId}${warnings.length ? " --allow-warnings" : ""}`,
      );

      if (
        (opts.autoConfirm || opts.complete) &&
        (result.summary.ready > 0 ||
          (opts.allowWarnings && result.summary.warnings > 0))
      ) {
        const sellerId = await resolveSellerId(prisma, opts.orgId);
        console.log(`\n>>> Auto-confirmando (sellerId=${sellerId})...`);
        const imported = await service.confirm({
          organizationId: opts.orgId,
          userId: sellerId,
          batchId: result.batchId,
          allowWarnings: opts.allowWarnings,
          skipStockValidation: true,
        });
        console.log("\n=== IMPORTACIÓN COMPLETADA ===");
        console.log(`Importadas: ${imported.imported}`);
        console.log(`Fallidas:   ${imported.failed}`);
        if (imported.errors.length > 0) {
          for (const e of imported.errors) {
            console.log(`  ${e.legacyKey}: ${e.error}`);
          }
        }
      }
      return;
    }

    if (!opts.batchId) {
      throw new Error("--confirm requiere --batch-id del preview");
    }

    const sellerId = await resolveSellerId(prisma, opts.orgId);
    console.log(`Vendedor (sellerId): ${sellerId}`);

    const result = await service.confirm({
      organizationId: opts.orgId,
      userId: sellerId,
      batchId: opts.batchId,
      allowWarnings: opts.allowWarnings,
      skipStockValidation: true,
    });

    console.log("\n=== IMPORTACIÓN COMPLETADA ===");
    console.log(`Importadas: ${result.imported}`);
    console.log(`Fallidas:   ${result.failed}`);
    if (result.errors.length > 0) {
      for (const e of result.errors) {
        console.log(`  ${e.legacyKey}: ${e.error}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
