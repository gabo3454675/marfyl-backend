/**
 * Plan B — conciliación FastReport (org=2) SIN apply por defecto.
 *
 * Uso:
 *   pnpm exec tsx scripts/reconcile-sales-fastreport-planb.ts
 *   pnpm exec tsx scripts/reconcile-sales-fastreport-planb.ts --dry-run
 *   pnpm exec tsx scripts/reconcile-sales-fastreport-planb.ts --apply   # explícito; NO ejecutar en TASK-004
 *
 * Artefactos:
 *   task002a manifests + task001b sku_mappings_after_create.json
 *
 * Prohibido en TASK-004: --apply, migrate deploy, InventoryMovement, crear productos.
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import {
  PLANB_SOURCE_HASH,
  PLANB_ORG_ID,
  buildPlanB,
  legacyInsertInvoicePayload,
  reconciledItemPayload,
  reconciledPayloadFromAction,
  type SourceFac,
  type SourceLine,
  type SkuMapping,
  type ExistingInvoice,
  type ExistingItem,
} from "../src/modules/sales-reconcile/planb-reconcile.planner";
import { validateInvoiceItemChecks } from "../src/modules/invoices/canonical/invoice-item-checks";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const TASK002A =
  process.env.PLANB_TASK002A_DIR ??
  path.join(
    process.env.HOME ?? "",
    ".local/share/marfyl-audit/task002a-b823b2f967c5",
  );
const SKU_MAPPINGS =
  process.env.PLANB_SKU_MAPPINGS ??
  path.join(
    process.env.HOME ?? "",
    ".local/share/marfyl-audit/task001b-remap-create-b823b2f967c5/sku_mappings_after_create.json",
  );

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const dryRun = !apply; // default dry-run; --apply requires explicit flag
  return { apply, dryRun };
}

function readNdjson<T>(filePath: string): T[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}

function loadSource(): { facs: SourceFac[]; lines: SourceLine[]; sourceHash: string } {
  const facsRaw = readNdjson<Record<string, unknown>>(
    path.join(TASK002A, "fac_manifest.ndjson"),
  );
  const linesRaw = readNdjson<Record<string, unknown>>(
    path.join(TASK002A, "line_manifest.ndjson"),
  );

  const facs: SourceFac[] = facsRaw
    .filter((f) => f.documentType === "FAC")
    .map((f) => ({
      documentNumber: String(f.documentNumber),
      saleDate: String(f.saleDate),
      headerNet: String(f.headerNet ?? (f.header as { net?: string })?.net ?? "0"),
      lineCount: Number(f.lineCount ?? 0),
    }));

  const lines: SourceLine[] = linesRaw
    .filter((l) => l.documentType === "FAC")
    .map((l) => ({
      documentNumber: String(l.documentNumber),
      sourceLineNumber: Number(l.sourceLineNumber),
      sourceLineKey: String(l.sourceLineKey),
      sourceSkuExact: String(l.sourceSkuExact),
      description: String(l.description ?? ""),
      quantity: String(l.quantity),
      detailedQuantity:
        l.detailedQuantity == null ? null : String(l.detailedQuantity),
      effectiveQuantity: String(l.effectiveQuantity),
      linePriceTotal: String(l.linePriceTotal),
    }));

  const sourceHash =
    String(linesRaw[0]?.sourceHash ?? facsRaw[0]?.sourceHash ?? "") ||
    PLANB_SOURCE_HASH;

  return { facs, lines, sourceHash };
}

function loadSkuMappings(): SkuMapping[] {
  const raw = JSON.parse(fs.readFileSync(SKU_MAPPINGS, "utf8")) as {
    mappings: Array<{
      sourceSkuExact: string;
      productId: number;
      decision: string;
    }>;
    sourceHash?: string;
  };
  if (raw.sourceHash && raw.sourceHash !== PLANB_SOURCE_HASH) {
    throw new Error(
      `SKU mappings sourceHash mismatch: ${raw.sourceHash} != ${PLANB_SOURCE_HASH}`,
    );
  }
  return raw.mappings.map((m) => ({
    sourceSkuExact: m.sourceSkuExact,
    productId: m.productId,
    decision: m.decision,
  }));
}

function parseSaleDate(ddmmyyyy: string): Date {
  // "01/07/2026"
  const [dd, mm, yyyy] = ddmmyyyy.split("/").map(Number);
  return new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0));
}

async function loadDbSnapshot(prisma: PrismaClient): Promise<{
  invoices: ExistingInvoice[];
  items: ExistingItem[];
  catalogBySkuExact: Map<string, number>;
  catalogBySkuNormalized: Map<string, number>;
}> {
  // Incluye soft-deleted: keys FAC-* con deletedAt NOT NULL deben RESTORE,
  // no INSERT (evita P2002 unique organizationId+legacyImportKey).
  const invoicesRaw = await prisma.invoice.findMany({
    where: {
      organizationId: PLANB_ORG_ID,
      legacyImportKey: { startsWith: "FAC-" },
    },
    select: {
      id: true,
      legacyImportKey: true,
      paymentStatus: true,
      paymentMethod: true,
      deletedAt: true,
      _count: { select: { paymentLines: true, pagos: true } },
    },
  });

  const invoices: ExistingInvoice[] = invoicesRaw.map((i) => ({
    id: i.id,
    legacyImportKey: i.legacyImportKey,
    paymentStatus: String(i.paymentStatus),
    paymentMethod: i.paymentMethod,
    paymentLineCount: i._count.paymentLines,
    pagoCount: i._count.pagos,
    deletedAt: i.deletedAt,
  }));

  const invoiceIds = invoices.map((i) => i.id);
  // Idempotencia: solo ítems ACTIVE participan en matching UPDATE/SUPERSEDE.
  // SUPERSEDED se conservan para auditoría y no deben volver a emparejarse
  // en re-ejecuciones del plan (UNIQUE parcial ACTIVE + este filtro).
  const itemsRaw =
    invoiceIds.length === 0
      ? []
      : await prisma.invoiceItem.findMany({
          where: {
            invoiceId: { in: invoiceIds },
            lineageStatus: "ACTIVE",
          },
          select: {
            id: true,
            invoiceId: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            subtotal: true,
          },
        });

  const items: ExistingItem[] = itemsRaw.map((it) => ({
    id: it.id,
    invoiceId: it.invoiceId,
    productId: it.productId,
    quantity: it.quantity,
    unitPrice: it.unitPrice.toString(),
    subtotal: it.subtotal.toString(),
  }));

  const products = await prisma.product.findMany({
    where: { organizationId: PLANB_ORG_ID, isActive: true },
    select: { id: true, sku: true },
  });
  const bySku = new Map<string, number[]>();
  const byNorm = new Map<string, number[]>();
  for (const p of products) {
    if (!p.sku) continue;
    const list = bySku.get(p.sku) ?? [];
    list.push(p.id);
    bySku.set(p.sku, list);
    const n = p.sku.replace(/\s+/gu, "").toUpperCase();
    const nlist = byNorm.get(n) ?? [];
    nlist.push(p.id);
    byNorm.set(n, nlist);
  }
  const catalogBySkuExact = new Map<string, number>();
  for (const [sku, ids] of bySku) {
    if (ids.length === 1) catalogBySkuExact.set(sku, ids[0]);
  }
  const catalogBySkuNormalized = new Map<string, number>();
  for (const [sku, ids] of byNorm) {
    const uniq = [...new Set(ids)];
    if (uniq.length === 1) catalogBySkuNormalized.set(sku, uniq[0]);
  }

  return { invoices, items, catalogBySkuExact, catalogBySkuNormalized };
}

function assertReconciledPayloadOrThrow(
  payload: ReturnType<typeof reconciledItemPayload>,
  context: string,
): void {
  const check = validateInvoiceItemChecks(payload);
  if (!check.ok) {
    throw new Error(
      `RECONCILED payload inválido (${context}): ${check.violations.join("; ")}`,
    );
  }
}

async function applyPlan(
  prisma: PrismaClient,
  plan: ReturnType<typeof buildPlanB>,
): Promise<void> {
  // Agrupar INSERT_FAC_LINE por documento
  const facLines = new Map<string, typeof plan.actions>();
  for (const a of plan.actions) {
    if (a.action !== "INSERT_FAC_LINE") continue;
    const list = facLines.get(a.documentNumber) ?? [];
    list.push(a);
    facLines.set(a.documentNumber, list);
  }

  await prisma.$transaction(
    async (tx) => {
      // 0) Restore soft-deleted FAC antes de cualquier INSERT/UPDATE de ítems
      for (const a of plan.actions) {
        if (a.action !== "RESTORE_INVOICE") continue;
        await tx.invoice.update({
          where: { id: a.invoiceId },
          data: {
            deletedAt: null,
            status: "PAID",
          },
        });
      }

      // 1) Insert FAC nuevas (solo keys ausentes; nunca soft-deleted)
      for (const [doc, lines] of facLines) {
        const first = lines[0];
        if (!first || first.action !== "INSERT_FAC_LINE") continue;
        const header = legacyInsertInvoicePayload(
          doc,
          first.headerNet,
          first.saleDate,
        );
        const itemCreates = lines
          .filter(
            (l): l is Extract<typeof l, { action: "INSERT_FAC_LINE" }> =>
              l.action === "INSERT_FAC_LINE",
          )
          .map((l) => {
            const payload = reconciledPayloadFromAction(l);
            assertReconciledPayloadOrThrow(
              payload,
              `INSERT_FAC_LINE ${doc}/${l.sourceLineKey}`,
            );
            return payload;
          });
        const inv = await tx.invoice.create({
          data: {
            companyId: header.companyId,
            organizationId: header.organizationId,
            customerId: header.customerId,
            sellerId: null,
            legacyImportKey: header.legacyImportKey,
            importSource: header.importSource,
            isLegacyImport: true,
            status: "PAID",
            paymentStatus: "PROCESSED_LEGACY",
            paymentMethod: "unknown_legacy",
            totalAmount: header.totalAmount,
            issueDate: parseSaleDate(header.saleDate),
            items: { create: itemCreates },
          },
        });
        void inv;
      }

      // 2) Updates / supersede / insert on existing (+ restored)
      for (const a of plan.actions) {
        if (a.action === "RESTORE_INVOICE") continue;
        if (a.action === "UPDATE_EXACT" || a.action === "UPDATE_RESIDUAL_1_1") {
          const payload = reconciledPayloadFromAction(a);
          assertReconciledPayloadOrThrow(
            payload,
            `${a.action} itemId=${a.invoiceItemId}`,
          );
          await tx.invoiceItem.update({
            where: { id: a.invoiceItemId },
            data: payload,
          });
        } else if (a.action === "SUPERSEDE_PLUS_INSERT") {
          const payload = reconciledPayloadFromAction(a);
          assertReconciledPayloadOrThrow(
            payload,
            `SUPERSEDE_PLUS_INSERT ${a.sourceLineKey}`,
          );
          await tx.invoiceItem.updateMany({
            where: { id: { in: a.supersedeItemIds } },
            data: { lineageStatus: "SUPERSEDED" },
          });
          await tx.invoiceItem.create({
            data: {
              invoiceId: a.invoiceId,
              ...payload,
            },
          });
        } else if (a.action === "INSERT_ITEM_ON_EXISTING") {
          const payload = reconciledPayloadFromAction(a);
          assertReconciledPayloadOrThrow(
            payload,
            `INSERT_ITEM_ON_EXISTING ${a.sourceLineKey}`,
          );
          await tx.invoiceItem.create({
            data: {
              invoiceId: a.invoiceId,
              ...payload,
            },
          });
        }
      }
    },
    { timeout: 600_000 },
  );
}

async function main() {
  const opts = parseArgs();
  console.log("=== Plan B reconcile-sales-fastreport ===");
  console.log(`Mode: ${opts.apply ? "APPLY" : "DRY-RUN (default)"}`);
  console.log(`Source hash: ${PLANB_SOURCE_HASH}`);
  console.log(`task002a: ${TASK002A}`);
  console.log(`sku map:  ${SKU_MAPPINGS}`);

  if (!fs.existsSync(TASK002A)) {
    throw new Error(`No existe TASK-002A dir: ${TASK002A}`);
  }
  if (!fs.existsSync(SKU_MAPPINGS)) {
    throw new Error(`No existe sku mappings: ${SKU_MAPPINGS}`);
  }

  const { facs, lines, sourceHash } = loadSource();
  const skuMappings = loadSkuMappings();
  console.log(`FAC fuente: ${facs.length}; líneas: ${lines.length}`);
  console.log(`SKU mappings APPROVE: ${skuMappings.filter((m) => m.decision === "APPROVE").length}`);

  if (skuMappings.length !== 42) {
    console.warn(`WARN: se esperaban 42 mappings, hay ${skuMappings.length}`);
  }
  if (skuMappings.some((m) => m.productId == null || m.decision !== "APPROVE")) {
    throw new Error("Mappings incompletos: todos deben ser APPROVE con productId");
  }

  const prisma = new PrismaClient();
  try {
    const snap = await loadDbSnapshot(prisma);
    const activeCount = snap.invoices.filter((i) => i.deletedAt == null).length;
    const softCount = snap.invoices.filter((i) => i.deletedAt != null).length;
    console.log(
      `DB org=2 FAC-* : ${snap.invoices.length} invoices (active=${activeCount}, softDeleted=${softCount}), ${snap.items.length} ACTIVE items, catalog unique SKUs: ${snap.catalogBySkuExact.size}`,
    );

    const plan = buildPlanB({
      sourceHash,
      facs,
      lines,
      existingInvoices: snap.invoices,
      existingItems: snap.items,
      skuMappings,
      catalogBySkuExact: snap.catalogBySkuExact,
      catalogBySkuNormalized: snap.catalogBySkuNormalized,
    });

    console.log("\n--- Contadores dry-run ---");
    console.log(JSON.stringify(plan.counters, null, 2));
    console.log(
      `Esperado ≈: existingActive=583 existingSoftDeleted=11 existingFac=594 insertTrulyMissing=504 restoreCount=11`,
    );
    console.log(
      `Check: existingFac+insertFac=${plan.counters.existingFac + plan.counters.insertFac} (debe=1098)`,
    );
    console.log(`blocked: ${plan.blocked} ${plan.blockers.join("; ") || "(none)"}`);
    console.log(`actions: ${plan.actions.length}`);
    console.log(
      `INSERT_FAC docs: ${plan.insertFacDocuments.length}; RESTORE: ${plan.counters.restoreCount}; preserve payments: ${plan.preservePaymentInvoiceIds.length}`,
    );

    if (opts.dryRun) {
      console.log("\nDRY-RUN complete. No se escribió nada. No --apply ejecutado.");
      process.exit(plan.blocked ? 2 : 0);
    }

    if (plan.blocked) {
      console.error("BLOCKED: no se puede aplicar con blockers activos.");
      process.exit(2);
    }

    console.log("\n>>> APPLY explícito: escribiendo conciliación (sin InventoryMovement)...");
    await applyPlan(prisma, plan);
    console.log("APPLY complete.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
