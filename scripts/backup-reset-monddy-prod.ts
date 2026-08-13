/**
 * Backup y reinicio a cero de Monddy en PRODUCCION.
 *
 * Conserva: org, miembros/usuarios, clientes, proveedores, mesas,
 * perfil fiscal, concierto, nominas (perfiles).
 *
 * Borra: catalogo de productos/variantes, facturas, movimientos, gastos,
 * comandas, caja, creditos, snapshots de licores, libros IVA derivados,
 * secuencia de facturas. El inventario se carga de cero por Excel.
 *
 *   DATABASE_URL="<prod>" ./node_modules/.bin/tsx scripts/backup-reset-monddy-prod.ts --prod --backup
 *   DATABASE_URL="<prod>" ./node_modules/.bin/tsx scripts/backup-reset-monddy-prod.ts --prod --reset --preview
 *   DATABASE_URL="<prod>" ./node_modules/.bin/tsx scripts/backup-reset-monddy-prod.ts --prod --reset --apply
 *
 * Backup + reset en un paso (siempre hace backup antes de borrar):
 *   DATABASE_URL="<prod>" ./node_modules/.bin/tsx scripts/backup-reset-monddy-prod.ts --prod --backup --reset --apply
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const WANT_PROD = process.argv.includes("--prod");
const DO_BACKUP = process.argv.includes("--backup");
const DO_RESET = process.argv.includes("--reset");
const APPLY = process.argv.includes("--apply");
const ORG_SLUG = "monddy";
const PROD_HOST = "ep-super-art";
const STAGING_HOST = "ep-curly-star";

function dbHost(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : "(sin DATABASE_URL)";
  } catch {
    return "(url invalida)";
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toNumber" in value &&
    typeof (value as { toNumber?: unknown }).toNumber === "function"
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return value;
}

async function main() {
  if (!DO_BACKUP && !DO_RESET) {
    throw new Error("Pasa --backup y/o --reset. Obligatorio --prod.");
  }

  const url = process.env.DATABASE_URL ?? "";
  const host = dbHost(url);
  const isProd = url.includes(PROD_HOST);
  const isStaging = url.includes(STAGING_HOST);

  if (!WANT_PROD) {
    throw new Error("Este script solo corre con --prod.");
  }
  if (!isProd) {
    throw new Error(
      `--prod requiere DATABASE_URL de produccion (${PROD_HOST}). Host actual: ${host}`,
    );
  }
  if (isStaging) {
    throw new Error("DATABASE_URL apunta a staging. Abortado.");
  }

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({
      where: { slug: ORG_SLUG, deletedAt: null },
      select: { id: true, slug: true, nombre: true },
    });
    if (!org) throw new Error("Org Monddy no encontrada");
    if (org.slug !== ORG_SLUG) {
      throw new Error(`Slug inesperado: ${org.slug}`);
    }

    const oid = org.id;
    console.log(`\n=== Monddy prod ${org.nombre} id=${oid} host=${host} ===`);
    console.log(
      `Modo: backup=${DO_BACKUP} reset=${DO_RESET} apply=${APPLY && DO_RESET}`,
    );

    const counts = await countOps(prisma, oid);
    console.log("\n-- Conteos actuales --");
    for (const [k, v] of Object.entries(counts)) {
      console.log(`  ${k.padEnd(28)} ${v}`);
    }

    let backupDir: string | null = null;
    if (DO_BACKUP) {
      backupDir = join(
        process.cwd(),
        "backups",
        `monddy-prod-${stamp()}`,
      );
      mkdirSync(backupDir, { recursive: true });
      await dumpBackup(prisma, oid, org, backupDir, counts);
      console.log(`\nBackup escrito en ${backupDir}`);
    }

    if (!DO_RESET) return;

    if (!APPLY) {
      console.log(
        "\nPreview only. No se borro nada. Para aplicar:\n  --prod --backup --reset --apply",
      );
      return;
    }

    if (!backupDir) {
      throw new Error(
        "Reset --apply exige --backup en el mismo comando para no perder datos.",
      );
    }

    await applyReset(prisma, oid);
    const after = await countOps(prisma, oid);
    const membersLeft = await prisma.member.count({
      where: { organizationId: oid },
    });
    console.log("\n-- Conteos despues --");
    for (const [k, v] of Object.entries(after)) {
      console.log(`  ${k.padEnd(28)} ${v}`);
    }
    console.log(`  members                    ${membersLeft}`);
    console.log("\nMonddy en prod: catalogo vacio, usuarios intactos.");
  } finally {
    await prisma.$disconnect();
  }
}

async function countOps(prisma: PrismaClient, oid: number) {
  const [
    products,
    invoices,
    movements,
    expenses,
    floorOrders,
    cierres,
    cashHolds,
    credits,
  ] = await Promise.all([
    prisma.product.count({ where: { organizationId: oid } }),
    prisma.invoice.count({ where: { organizationId: oid } }),
    prisma.inventoryMovement.count({ where: { tenantId: oid } }),
    prisma.expense.count({ where: { organizationId: oid } }),
    prisma.floorOrder.count({ where: { organizationId: oid } }),
    prisma.cierreCaja.count({ where: { tenantId: oid } }),
    prisma.cashHold.count({ where: { organizationId: oid } }),
    prisma.customerCredit.count({ where: { organizationId: oid } }),
  ]);
  return {
    products,
    invoices,
    movements,
    expenses,
    floorOrders,
    cierres,
    cashHolds,
    credits,
  };
}

async function dumpBackup(
  prisma: PrismaClient,
  oid: number,
  org: { id: number; slug: string; nombre: string },
  dir: string,
  counts: Record<string, number>,
) {
  writeFileSync(
    join(dir, "_meta.json"),
    JSON.stringify(
      {
        org,
        host: dbHost(process.env.DATABASE_URL),
        createdAt: new Date().toISOString(),
        counts,
      },
      jsonReplacer,
      2,
    ),
  );

  const dumps: Array<[string, Promise<unknown>]> = [
    ["organization", prisma.organization.findMany({ where: { id: oid } })],
    ["members", prisma.member.findMany({ where: { organizationId: oid } })],
    ["products", prisma.product.findMany({ where: { organizationId: oid } })],
    [
      "product_variants",
      prisma.productVariant.findMany({
        where: { product: { organizationId: oid } },
      }),
    ],
    ["customers", prisma.customer.findMany({ where: { organizationId: oid } })],
    ["suppliers", prisma.supplier.findMany({ where: { organizationId: oid } })],
    ["invoices", prisma.invoice.findMany({ where: { organizationId: oid } })],
    [
      "invoice_items",
      prisma.invoiceItem.findMany({
        where: { invoice: { organizationId: oid } },
      }),
    ],
    [
      "invoice_payment_lines",
      prisma.invoicePaymentLine.findMany({
        where: { invoice: { organizationId: oid } },
      }),
    ],
    ["pagos", prisma.pago.findMany({ where: { tenantId: oid } })],
    [
      "inventory_movements",
      prisma.inventoryMovement.findMany({ where: { tenantId: oid } }),
    ],
    ["expenses", prisma.expense.findMany({ where: { organizationId: oid } })],
    [
      "expense_payments",
      prisma.expensePayment.findMany({
        where: { expense: { organizationId: oid } },
      }),
    ],
    [
      "floor_orders",
      prisma.floorOrder.findMany({ where: { organizationId: oid } }),
    ],
    [
      "floor_order_items",
      prisma.floorOrderItem.findMany({
        where: { floorOrder: { organizationId: oid } },
      }),
    ],
    [
      "floor_table_accounts",
      prisma.floorTableAccount.findMany({ where: { organizationId: oid } }),
    ],
    ["cierres_caja", prisma.cierreCaja.findMany({ where: { tenantId: oid } })],
    ["cash_holds", prisma.cashHold.findMany({ where: { organizationId: oid } })],
    [
      "customer_credits",
      prisma.customerCredit.findMany({ where: { organizationId: oid } }),
    ],
    [
      "credit_transactions",
      prisma.creditTransaction.findMany({
        where: { credit: { organizationId: oid } },
      }),
    ],
    [
      "liquor_day_snapshots",
      prisma.liquorDaySnapshot.findMany({ where: { organizationId: oid } }),
    ],
    [
      "libro_venta_lines",
      prisma.libroVentaLine.findMany({ where: { organizationId: oid } }),
    ],
    [
      "libro_compra_lines",
      prisma.libroCompraLine.findMany({ where: { organizationId: oid } }),
    ],
    [
      "invoice_sequence",
      prisma.organizationInvoiceSequence.findMany({
        where: { organizationId: oid },
      }),
    ],
  ];

  for (const [name, promise] of dumps) {
    const rows = await promise;
    writeFileSync(
      join(dir, `${name}.json`),
      JSON.stringify(rows, jsonReplacer),
    );
    const n = Array.isArray(rows) ? rows.length : 0;
    console.log(`  dump ${name}: ${n}`);
  }
}

async function applyReset(prisma: PrismaClient, oid: number) {
  console.log("\nAplicando reset Monddy...");
  await prisma.$transaction(
    async (tx) => {
      await tx.task.updateMany({
        where: { organizationId: oid, invoiceId: { not: null } },
        data: { invoiceId: null },
      });
      await tx.creditTransaction.updateMany({
        where: { credit: { organizationId: oid }, invoiceId: { not: null } },
        data: { invoiceId: null },
      });
      await tx.floorOrder.updateMany({
        where: { organizationId: oid, chargedInvoiceId: { not: null } },
        data: { chargedInvoiceId: null },
      });
      await tx.floorTableAccount.updateMany({
        where: { organizationId: oid, closedInvoiceId: { not: null } },
        data: { closedInvoiceId: null },
      });
      await tx.libroVentaLine.updateMany({
        where: { organizationId: oid, invoiceId: { not: null } },
        data: { invoiceId: null },
      });

      await tx.floorOrderItem.deleteMany({
        where: { floorOrder: { organizationId: oid } },
      });
      await tx.floorTablePayment.deleteMany({
        where: { account: { organizationId: oid } },
      });
      await tx.floorOrder.deleteMany({ where: { organizationId: oid } });
      await tx.floorTableAccount.deleteMany({ where: { organizationId: oid } });

      await tx.creditTransaction.deleteMany({
        where: { credit: { organizationId: oid } },
      });
      await tx.customerCredit.deleteMany({ where: { organizationId: oid } });

      await tx.payrollLine.updateMany({
        where: { organizationId: oid, expenseId: { not: null } },
        data: { expenseId: null },
      });
      await tx.retencionIVA.deleteMany({ where: { organizationId: oid } });
      await tx.libroCompraLine.deleteMany({ where: { organizationId: oid } });
      await tx.libroVentaLine.deleteMany({ where: { organizationId: oid } });
      await tx.expensePayment.deleteMany({ where: { organizationId: oid } });
      await tx.expense.deleteMany({ where: { organizationId: oid } });
      await tx.inventoryMovement.deleteMany({ where: { tenantId: oid } });

      await tx.invoicePaymentLine.deleteMany({
        where: { invoice: { organizationId: oid } },
      });
      await tx.pago.deleteMany({ where: { tenantId: oid } });
      await tx.invoiceItem.deleteMany({
        where: { invoice: { organizationId: oid } },
      });
      await tx.invoice.deleteMany({ where: { organizationId: oid } });

      await tx.cierreCaja.deleteMany({ where: { tenantId: oid } });
      await tx.cashHold.deleteMany({ where: { organizationId: oid } });
      await tx.liquorDaySnapshot.deleteMany({ where: { organizationId: oid } });
      await tx.salesImportPreviewBatch.deleteMany({
        where: { organizationId: oid },
      });
      await tx.activityLog.deleteMany({ where: { organizationId: oid } });

      await tx.organizationInvoiceSequence.upsert({
        where: { organizationId: oid },
        create: { organizationId: oid, nextNumber: 1 },
        update: { nextNumber: 1 },
      });

      await tx.productVariant.deleteMany({
        where: { product: { organizationId: oid } },
      });
      await tx.product.deleteMany({ where: { organizationId: oid } });
    },
    { timeout: 180000, maxWait: 20000 },
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
