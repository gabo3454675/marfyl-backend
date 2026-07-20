/**
 * Cuadra ventas Monddy (org 2) semana 13–19 jul 2026 con el resumen
 * operativo del cliente ("Calculado en Divisas") y corrige totales del
 * Excel FastReport del 15/07 cuando el header neto no coincidía.
 *
 * Uso:
 *   pnpm exec tsx scripts/reconcile-monddy-week-jul13-19.ts --preview
 *   pnpm exec tsx scripts/reconcile-monddy-week-jul13-19.ts --apply
 */
import "dotenv/config";
import fs from "fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { parseFastReportSalesFile } from "../src/modules/sales-import/fastreport.parser";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const ORG_ID = 2;
const APPLY = process.argv.includes("--apply");

/** Resumen WhatsApp del operador — Calculado en Divisas (USD). */
const TARGET_USD: Record<string, number> = {
  "2026-07-13": 225.24,
  "2026-07-14": 276,
  "2026-07-15": 328,
  "2026-07-16": 256.07,
  "2026-07-17": 541.31,
  "2026-07-18": 522,
  "2026-07-19": 2024,
};

const EXCEL_FIXES = [
  {
    path: "/home/gabdev/Descargas/FACTURAS/Reporte General  de Productos Vendidos_15_07_26.xls",
    day: "15/07/2026",
  },
];

const CUADRE_PREFIX = "CUADRE-DIARIO-";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function caracasDaySql(): string {
  return `((i."issueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Caracas')::date`;
}

async function dayTotal(
  prisma: PrismaClient,
  day: string,
  opts?: { excludeCuadre?: boolean },
) {
  const exclude = opts?.excludeCuadre !== false;
  const rows = (await prisma.$queryRawUnsafe(
    `
    SELECT ROUND(COALESCE(SUM(i."totalAmount"),0)::numeric, 2) AS usd,
           COUNT(*)::int AS n
    FROM invoices i
    WHERE i."organizationId" = $1
      AND i.status = 'PAID'
      AND i."deletedAt" IS NULL
      AND ${caracasDaySql()} = $2::date
      ${exclude ? `AND (i."legacyImportKey" IS NULL OR i."legacyImportKey" NOT LIKE '${CUADRE_PREFIX}%')` : ""}
    `,
    ORG_ID,
    day,
  )) as { usd: string | number; n: number }[];
  return {
    usd: Number(rows[0]?.usd ?? 0),
    n: Number(rows[0]?.n ?? 0),
  };
}

async function ensureCuadreProduct(prisma: PrismaClient, orgId: number) {
  const existing = await prisma.product.findFirst({
    where: {
      organizationId: orgId,
      isActive: true,
      OR: [
        { sku: "CUADRE-DIARIO" },
        { name: { equals: "Cuadre diario de ventas", mode: "insensitive" } },
      ],
    },
  });
  if (existing) return existing;

  const companyId =
    (
      await prisma.invoice.findFirst({
        where: { organizationId: orgId, deletedAt: null },
        select: { companyId: true },
      })
    )?.companyId ??
    (await prisma.company.findFirst({ select: { id: true }, orderBy: { id: "asc" } }))
      ?.id;
  if (!companyId) throw new Error("Sin company para Monddy");

  return prisma.product.create({
    data: {
      organizationId: orgId,
      companyId,
      name: "Cuadre diario de ventas",
      sku: "CUADRE-DIARIO",
      salePrice: 0,
      costPrice: 0,
      stock: 0,
      isService: true,
      isExempt: true,
      salePriceCurrency: "USD",
      isActive: true,
    },
  });
}

async function fixExcelHeaders(prisma: PrismaClient) {
  const changes: { key: string; from: number; to: number }[] = [];
  for (const fix of EXCEL_FIXES) {
    if (!fs.existsSync(fix.path)) {
      console.warn(`Excel no encontrado: ${fix.path}`);
      continue;
    }
    const parsed = parseFastReportSalesFile(
      fs.readFileSync(fix.path, "utf8"),
      fix.path,
    ).filter((i) => i.saleDate === fix.day);

    for (const inv of parsed) {
      const header =
        inv.headerTotalNet ??
        inv.lines.reduce((s, l) => s + l.lineTotal, 0);
      const row = await prisma.invoice.findFirst({
        where: {
          organizationId: ORG_ID,
          legacyImportKey: inv.legacyKey,
          deletedAt: null,
        },
        select: { id: true, totalAmount: true, montoUsd: true },
      });
      if (!row) continue;
      const from = Number(row.totalAmount);
      const to = round2(header);
      if (Math.abs(from - to) < 0.01) continue;
      changes.push({ key: inv.legacyKey, from, to });
      if (APPLY) {
        await prisma.invoice.update({
          where: { id: row.id },
          data: {
            totalAmount: new Prisma.Decimal(to),
            montoUsd: new Prisma.Decimal(to),
            montoBs: new Prisma.Decimal(0),
          },
        });
      }
    }
  }
  return changes;
}

async function allocateConsecutive(prisma: PrismaClient, organizationId: number) {
  const bumped = await prisma.$queryRaw<{ allocated: number }[]>`
    UPDATE "organization_invoice_sequences"
    SET "nextNumber" = "nextNumber" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "organizationId" = ${organizationId}
    RETURNING "nextNumber" - 1 AS allocated
  `;
  if (bumped.length > 0) return bumped[0].allocated;
  const max = await prisma.invoice.aggregate({
    where: { organizationId },
    _max: { consecutiveNumber: true },
  });
  const start = (max._max.consecutiveNumber ?? 0) + 1;
  await prisma.organizationInvoiceSequence.create({
    data: { organizationId, nextNumber: start + 1 },
  });
  return start;
}

async function upsertCuadre(
  prisma: PrismaClient,
  day: string,
  amount: number,
  productId: number,
  sellerId: number,
  customerId: number,
  companyId: number,
  rate: number,
) {
  const legacyKey = `${CUADRE_PREFIX}${day}`;
  const issueDate = new Date(`${day}T16:00:00.000Z`);
  const existing = await prisma.invoice.findFirst({
    where: { organizationId: ORG_ID, legacyImportKey: legacyKey },
  });

  if (Math.abs(amount) < 0.01) {
    if (existing && !existing.deletedAt && APPLY) {
      await prisma.invoice.update({
        where: { id: existing.id },
        data: { deletedAt: new Date(), status: "CANCELLED" },
      });
      return { legacyKey, action: "removed" as const, amount: 0 };
    }
    return { legacyKey, action: "skip" as const, amount: 0 };
  }

  if (!APPLY) {
    return {
      legacyKey,
      action: existing ? ("would-update" as const) : ("would-create" as const),
      amount,
    };
  }

  if (existing) {
    await prisma.$transaction([
      prisma.invoiceItem.deleteMany({ where: { invoiceId: existing.id } }),
      prisma.invoice.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          status: "PAID",
          issueDate,
          totalAmount: new Prisma.Decimal(amount),
          montoUsd: new Prisma.Decimal(amount),
          montoBs: new Prisma.Decimal(0),
          tasaReferencia: rate,
          paymentMethod: "CASH",
          paymentStatus: "paid",
          isLegacyImport: true,
          notes: `Cuadre operativo vs resumen en divisas del operador (${day})`,
        },
      }),
      prisma.invoiceItem.create({
        data: {
          invoiceId: existing.id,
          productId,
          quantity: 1,
          unitPrice: new Prisma.Decimal(amount),
          subtotal: new Prisma.Decimal(amount),
          taxRate: 0,
          taxableBase: new Prisma.Decimal(0),
          ivaLine: new Prisma.Decimal(0),
        },
      }),
    ]);
    return { legacyKey, action: "updated" as const, amount };
  }

  const consecutiveNumber = await allocateConsecutive(prisma, ORG_ID);
  const { randomBytes } = await import("crypto");
  const created = await prisma.invoice.create({
    data: {
      organizationId: ORG_ID,
      companyId,
      customerId,
      sellerId,
      status: "PAID",
      paymentStatus: "paid",
      issueDate,
      createdAt: issueDate,
      updatedAt: issueDate,
      totalAmount: new Prisma.Decimal(amount),
      montoUsd: new Prisma.Decimal(amount),
      montoBs: new Prisma.Decimal(0),
      tasaReferencia: rate,
      paymentMethod: "CASH",
      isLegacyImport: true,
      legacyImportKey: legacyKey,
      importSource: "cuadre-operativo",
      consecutiveNumber,
      publicToken: randomBytes(32).toString("hex"),
      notes: `Cuadre operativo vs resumen en divisas del operador (${day})`,
      items: {
        create: [
          {
            productId,
            quantity: 1,
            unitPrice: new Prisma.Decimal(amount),
            subtotal: new Prisma.Decimal(amount),
            taxRate: 0,
            taxableBase: new Prisma.Decimal(0),
            ivaLine: new Prisma.Decimal(0),
          },
        ],
      },
    },
    select: { id: true },
  });
  return { legacyKey, action: "created" as const, amount, id: created.id };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({
      where: { id: ORG_ID, deletedAt: null },
      select: {
        id: true,
        nombre: true,
        exchangeRate: true,
      },
    });
    if (!org) throw new Error("Monddy no encontrada");
    console.log(
      `Org: ${org.nombre} | modo: ${APPLY ? "APPLY" : "PREVIEW"} | tasa Dólar BCV: ${org.exchangeRate}`,
    );

    console.log("\n=== 1) Corrección totales Excel 15/07 (header neto) ===");
    const excelChanges = await fixExcelHeaders(prisma);
    if (excelChanges.length === 0) console.log("Sin cambios de header.");
    else {
      for (const c of excelChanges) {
        console.log(
          `  ${c.key}: ${c.from.toFixed(2)} → ${c.to.toFixed(2)} (${c.to - c.from >= 0 ? "+" : ""}${(c.to - c.from).toFixed(2)})`,
        );
      }
    }

    const member = await prisma.member.findFirst({
      where: { organizationId: ORG_ID, status: "ACTIVE" },
      select: { userId: true },
      orderBy: { id: "asc" },
    });
    if (!member) throw new Error("Sin miembro activo");

    const sampleInv = await prisma.invoice.findFirst({
      where: { organizationId: ORG_ID, deletedAt: null },
      select: { companyId: true },
    });
    const companyId =
      sampleInv?.companyId ??
      (
        await prisma.company.findFirst({
          select: { id: true },
          orderBy: { id: "asc" },
        })
      )?.id;
    if (!companyId) throw new Error("Sin company");
    const company = { id: companyId };

    let customer = await prisma.customer.findFirst({
      where: {
        organizationId: ORG_ID,
        name: { contains: "CLIENTE NATURAL CONTADO", mode: "insensitive" },
      },
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          organizationId: ORG_ID,
          companyId: company.id,
          name: "CLIENTE NATURAL CONTADO",
          taxId: "V00000000",
        },
      });
    }

    const product = await ensureCuadreProduct(prisma, ORG_ID);
    const rate = Number(org.exchangeRate ?? 1);

    console.log("\n=== 2) Cuadre diario vs resumen operador ===");
    console.log(
      "Dia        | Target   | Base(sin cuadre) | Delta    | Acción",
    );

    let weekTarget = 0;
    let weekFinal = 0;

    for (const [day, target] of Object.entries(TARGET_USD)) {
      weekTarget += target;
      const base = await dayTotal(prisma, day, { excludeCuadre: true });
      const delta = round2(target - base.usd);
      const result = await upsertCuadre(
        prisma,
        day,
        delta,
        product.id,
        member.userId,
        customer.id,
        company.id,
        rate,
      );
      const after = APPLY
        ? await dayTotal(prisma, day, { excludeCuadre: false })
        : { usd: round2(base.usd + delta), n: base.n + (Math.abs(delta) >= 0.01 ? 1 : 0) };
      weekFinal += after.usd;
      console.log(
        `${day} | ${target.toFixed(2).padStart(8)} | ${base.usd.toFixed(2).padStart(16)} | ${delta.toFixed(2).padStart(8)} | ${result.action}`,
      );
    }

    console.log("\n=== 3) Semana ===");
    console.log(`Target operador: ${weekTarget.toFixed(2)}`);
    console.log(`Sistema tras cuadre: ${weekFinal.toFixed(2)}`);
    console.log(`Diff: ${(weekFinal - weekTarget).toFixed(2)}`);
    if (!APPLY) {
      console.log(
        "\nPreview only. Para aplicar:\n  pnpm exec tsx scripts/reconcile-monddy-week-jul13-19.ts --apply",
      );
    } else {
      console.log("\nAplicado. Verifica dashboard / historial Monddy.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
