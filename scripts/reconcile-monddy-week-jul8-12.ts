/**
 * Cuadra ventas Monddy 8–12 jul 2026 contra los Excel FastReport.
 * - Actualiza totalAmount al header neto del Excel
 * - Soft-delete de facturas en DB que no están en Excel (restaura stock)
 *
 *   ./node_modules/.bin/tsx scripts/reconcile-monddy-week-jul8-12.ts --preview
 *   ./node_modules/.bin/tsx scripts/reconcile-monddy-week-jul8-12.ts --apply
 */
import "dotenv/config";
import fs from "fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { parseFastReportSalesFile } from "../src/modules/sales-import/fastreport.parser";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const ORG_ID = 2;
const APPLY = process.argv.includes("--apply");

const FILES = [
  "/home/gabdev/Descargas/FACTURAS/Reporte General de Ventas 08_17_2026.xls",
  "/home/gabdev/Descargas/FACTURAS/Reporte General de Ventas 09_17_2026.xls",
  "/home/gabdev/Descargas/FACTURAS/Reporte General  de Productos Vendidos fin de semana 10 al 12.xls",
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function toIso(dmy: string) {
  const [dd, mm, yyyy] = dmy.split("/");
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function veDay(d: Date) {
  return new Date(d.getTime() - 4 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const excel = new Map<
      string,
      { day: string; header: number; path: string }
    >();
    for (const path of FILES) {
      if (!fs.existsSync(path)) throw new Error(`No existe: ${path}`);
      const invs = parseFastReportSalesFile(fs.readFileSync(path, "utf8"), path);
      for (const inv of invs) {
        const day = toIso(inv.saleDate);
        if (day < "2026-07-08" || day > "2026-07-12") continue;
        const header = round2(
          inv.headerTotalNet ??
            inv.lines.reduce((s, l) => s + l.lineTotal, 0),
        );
        excel.set(inv.legacyKey, { day, header, path });
      }
    }

    const dbInvs = await prisma.invoice.findMany({
      where: {
        organizationId: ORG_ID,
        status: "PAID",
        deletedAt: null,
        issueDate: {
          gte: new Date("2026-07-08T04:00:00.000Z"),
          lt: new Date("2026-07-13T04:00:00.000Z"),
        },
      },
      select: {
        id: true,
        legacyImportKey: true,
        totalAmount: true,
        issueDate: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            product: { select: { isBundle: true, isService: true } },
          },
        },
      },
    });

    const totalFixes: {
      key: string;
      id: number;
      from: number;
      to: number;
    }[] = [];
    const orphans: {
      key: string;
      id: number;
      usd: number;
      day: string;
    }[] = [];

    for (const row of dbInvs) {
      const key = row.legacyImportKey;
      if (!key || key.startsWith("CUADRE-DIARIO-")) continue;
      const ex = excel.get(key);
      if (!ex) {
        orphans.push({
          key,
          id: row.id,
          usd: Number(row.totalAmount),
          day: veDay(row.issueDate),
        });
        continue;
      }
      const from = Number(row.totalAmount);
      if (Math.abs(from - ex.header) >= 0.01) {
        totalFixes.push({ key, id: row.id, from, to: ex.header });
      }
    }

    const excelDay = new Map<string, number>();
    for (const ex of excel.values()) {
      excelDay.set(ex.day, round2((excelDay.get(ex.day) ?? 0) + ex.header));
    }

    console.log(`Modo: ${APPLY ? "APPLY" : "PREVIEW"}`);
    console.log(`Excel keys 8–12: ${excel.size}`);
    console.log(`DB facturas 8–12: ${dbInvs.length}`);
    console.log(`Totales a corregir: ${totalFixes.length}`);
    console.log(`Huérfanas a soft-delete (+restock): ${orphans.length}`);
    for (const f of totalFixes.slice(0, 12)) {
      console.log(
        `  ${f.key}: ${f.from.toFixed(2)} → ${f.to.toFixed(2)} (${f.to - f.from >= 0 ? "+" : ""}${(f.to - f.from).toFixed(2)})`,
      );
    }
    if (totalFixes.length > 12) console.log(`  ... +${totalFixes.length - 12}`);
    for (const o of orphans) {
      console.log(`  DROP ${o.key} ${o.day} $${o.usd.toFixed(2)}`);
    }

    console.log("\nTargets Excel (header neto):");
    for (const day of ["2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11", "2026-07-12"]) {
      console.log(`  ${day}: $${(excelDay.get(day) ?? 0).toFixed(2)}`);
    }

    if (!APPLY) {
      console.log("\nPreview only. Para aplicar: --apply");
      return;
    }

    for (const f of totalFixes) {
      await prisma.invoice.update({
        where: { id: f.id },
        data: {
          totalAmount: new Prisma.Decimal(f.to),
          montoUsd: new Prisma.Decimal(f.to),
          montoBs: new Prisma.Decimal(0),
          notes: `Total alineado a header FastReport (${f.to.toFixed(2)} USD)`,
        },
      });
    }

    for (const o of orphans) {
      const inv = dbInvs.find((i) => i.id === o.id)!;
      await prisma.$transaction(async (tx) => {
        for (const item of inv.items) {
          if (item.product.isBundle || item.product.isService) continue;
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { increment: item.quantity } },
          });
        }
        await tx.invoice.update({
          where: { id: o.id },
          data: {
            deletedAt: new Date(),
            status: "CANCELLED",
            notes: "Fuera de reportes FastReport 8–12 jul; anulada en cuadre",
          },
        });
      });
    }

    const after = (await prisma.$queryRawUnsafe(
      `
      SELECT
        ((i."issueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Caracas')::date::text AS day,
        COUNT(*)::int AS n,
        ROUND(COALESCE(SUM(i."totalAmount"),0)::numeric, 2) AS usd
      FROM invoices i
      WHERE i."organizationId" = $1
        AND i.status = 'PAID'
        AND i."deletedAt" IS NULL
        AND ((i."issueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Caracas')::date
            BETWEEN '2026-07-08' AND '2026-07-12'
      GROUP BY 1 ORDER BY 1
      `,
      ORG_ID,
    )) as { day: string; n: number; usd: string | number }[];

    console.log("\n=== Verificación post-apply ===");
    let allOk = true;
    for (const row of after) {
      const target = excelDay.get(row.day) ?? 0;
      const usd = Number(row.usd);
      const ok = Math.abs(usd - target) < 0.02;
      if (!ok) allOk = false;
      console.log(
        `${row.day}: DB=${usd.toFixed(2)} Excel=${target.toFixed(2)} n=${row.n} [${ok ? "OK" : "DIFF"}]`,
      );
    }
    console.log(allOk ? "\nCuadre 8–12 OK." : "\nAún hay diferencias.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
