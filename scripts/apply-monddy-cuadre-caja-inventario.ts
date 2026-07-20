/**
 * Cuadre Monddy sin errores financieros:
 * 1) Registra Caja oficina USD 759 (CashHold — NO es venta).
 * 2) Ajusta stock a max(0, inv06 + compras − ventas) con MovementType.AJUSTE
 *    (sin Invoice ni Expense).
 *
 *   ./node_modules/.bin/tsx scripts/apply-monddy-cuadre-caja-inventario.ts --preview
 *   ./node_modules/.bin/tsx scripts/apply-monddy-cuadre-caja-inventario.ts --apply
 */
import "dotenv/config";
import { readFileSync } from "fs";
import * as ExcelJS from "exceljs";
import { PrismaClient, InvoiceStatus } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { parseMonddyPurchasesExcel } from "../src/modules/purchases-import/monddy-purchases.parser";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const ORG_ID = 2;
const APPLY = process.argv.includes("--apply");
const INVENTORY_FILE =
  "/home/gabdev/Descargas/FACTURAS/INVENTARIO MONDDY  06072026.xlsx";
const PURCHASES_FILE = "/home/gabdev/Descargas/FACTURAS/COMPRAS 07072026.xlsx";
const CUTOFF_END = new Date("2026-07-20T04:00:00.000Z");
const INV_START = new Date("2026-07-06T04:00:00.000Z");
const OFFICE_CASH_KEY = "monddy-caja-oficina-2026-07-19";
const OFFICE_CASH_USD = 759;
const AJUSTE_TAG = "AJUSTE-CUADRE-JUL2026";

function parseIntSafe(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Math.trunc(value);
  return parseInt(String(value).trim(), 10) || 0;
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;
  return parseFloat(String(value).replace(",", ".").trim());
}

async function parseInitialInventory(filePath: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const map = new Map<string, number>();
  for (let rowNum = 3; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = String(row.getCell(1).value ?? "").trim().toUpperCase();
    const category = String(row.getCell(2).value ?? "").trim();
    const price = parseNumber(row.getCell(4).value);
    const stock = parseIntSafe(row.getCell(7).value);
    const productName = String(row.getCell(8).value ?? "").trim();
    const name = productName || category;
    if (!sku || !name) continue;
    if (Number.isNaN(price) || price <= 0) continue;
    map.set(sku, (map.get(sku) ?? 0) + Math.max(0, stock));
  }
  return map;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const member = await prisma.member.findFirst({
      where: { organizationId: ORG_ID, status: "ACTIVE" },
      select: { userId: true },
      orderBy: { id: "asc" },
    });
    if (!member) throw new Error("Sin usuario activo Monddy");

    const initial = await parseInitialInventory(INVENTORY_FILE);
    const purchaseGroups = parseMonddyPurchasesExcel(
      readFileSync(PURCHASES_FILE),
    );
    const purchased = new Map<string, number>();
    for (const g of purchaseGroups) {
      for (const line of g.lines) {
        const sku = line.sku.trim().toUpperCase();
        if (!sku) continue;
        purchased.set(sku, (purchased.get(sku) ?? 0) + line.quantity);
      }
    }

    const products = await prisma.product.findMany({
      where: { organizationId: ORG_ID, isActive: true },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        isBundle: true,
        isService: true,
      },
    });
    const bySku = new Map(
      products
        .filter((p) => p.sku)
        .map((p) => [p.sku!.trim().toUpperCase(), p]),
    );
    const byId = new Map(products.map((p) => [p.id, p]));

    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: ORG_ID,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        issueDate: { gte: INV_START, lt: CUTOFF_END },
      },
      select: {
        items: { select: { productId: true, quantity: true } },
      },
    });
    const sold = new Map<string, number>();
    for (const inv of invoices) {
      for (const item of inv.items) {
        const p = byId.get(item.productId);
        if (!p?.sku || p.isBundle || p.isService) continue;
        const sku = p.sku.trim().toUpperCase();
        sold.set(sku, (sold.get(sku) ?? 0) + item.quantity);
      }
    }

    const already = await prisma.inventoryMovement.findMany({
      where: {
        tenantId: ORG_ID,
        type: "AJUSTE",
        reason: { contains: AJUSTE_TAG },
      },
      select: { productId: true, reason: true },
    });
    const alreadySku = new Set(
      already
        .map((m) => {
          const match = m.reason?.match(new RegExp(`${AJUSTE_TAG}:([^\\s]+)`));
          return match?.[1]?.toUpperCase();
        })
        .filter(Boolean) as string[],
    );

    type Adj = {
      productId: number;
      sku: string;
      name: string;
      from: number;
      to: number;
      delta: number;
      skip: boolean;
    };
    const adjustments: Adj[] = [];
    const skus = new Set([...initial.keys(), ...purchased.keys(), ...sold.keys(), ...bySku.keys()]);

    for (const sku of skus) {
      const prod = bySku.get(sku);
      if (!prod || prod.isBundle || prod.isService) continue;
      const rawExpected =
        (initial.get(sku) ?? 0) + (purchased.get(sku) ?? 0) - (sold.get(sku) ?? 0);
      // Piso operativo: nunca dejar negativo. No bajamos stock automático
      // (evita borrar existencias reales por SKU mal matcheado en compras).
      let to = prod.stock;
      if (prod.stock < 0) {
        to = Math.max(0, rawExpected);
      } else if (rawExpected > prod.stock && (initial.has(sku) || purchased.has(sku))) {
        // Solo reponer al alza cuando hay base documentada (inv o compra Excel)
        to = rawExpected;
      }
      const delta = to - prod.stock;
      if (delta === 0) continue;
      adjustments.push({
        productId: prod.id,
        sku,
        name: prod.name,
        from: prod.stock,
        to,
        delta,
        skip: alreadySku.has(sku),
      });
    }

    adjustments.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    console.log("\n=== Caja oficina (CashHold — NO venta) ===");
    console.log(`USD ${OFFICE_CASH_USD} | key=${OFFICE_CASH_KEY}`);

    console.log(`\n=== Ajustes stock (AJUSTE sin P&L) ===`);
    console.log(`Pendientes: ${adjustments.filter((a) => !a.skip).length}`);
    console.log(`Ya aplicados: ${adjustments.filter((a) => a.skip).length}`);
    for (const a of adjustments.slice(0, 25)) {
      console.log(
        `${a.skip ? "SKIP" : "DO  "} ${String(a.delta).padStart(5)} | ${a.from} → ${a.to} | ${a.sku.padEnd(14)} | ${a.name.slice(0, 40)}`,
      );
    }
    if (adjustments.length > 25) {
      console.log(`... +${adjustments.length - 25} más`);
    }

    const weekSales = 4172.62;
    console.log("\n=== Resumen operativo ===");
    console.log(`Ventas semana 13-19: $${weekSales.toFixed(2)}`);
    console.log(`Caja oficina (hold): $${OFFICE_CASH_USD.toFixed(2)}`);
    console.log(
      `Total efectivo operativo reportado: $${(weekSales + OFFICE_CASH_USD).toFixed(2)}`,
    );
    console.log(
      "(La caja oficina NO suma a ingresos/facturas; es saldo de tesorería.)",
    );

    if (!APPLY) {
      console.log("\nPreview only. Para aplicar: --apply");
      return;
    }

    const hold = await prisma.cashHold.upsert({
      where: { importKey: OFFICE_CASH_KEY },
      create: {
        organizationId: ORG_ID,
        location: "OFFICE",
        currency: "USD",
        amount: OFFICE_CASH_USD,
        asOf: new Date("2026-07-19T20:00:00.000Z"),
        label: "Caja oficina en divisas",
        notes:
          "Saldo reportado semana 13–19 jul 2026. No es venta POS; no afecta ingresos.",
        importKey: OFFICE_CASH_KEY,
        createdById: member.userId,
      },
      update: {
        amount: OFFICE_CASH_USD,
        asOf: new Date("2026-07-19T20:00:00.000Z"),
        label: "Caja oficina en divisas",
        notes:
          "Saldo reportado semana 13–19 jul 2026. No es venta POS; no afecta ingresos.",
      },
    });
    console.log(`\nCashHold id=${hold.id} amount=${hold.amount} ${hold.currency}`);

    let applied = 0;
    for (const a of adjustments) {
      if (a.skip) continue;
      await prisma.$transaction(async (tx) => {
        await tx.inventoryMovement.create({
          data: {
            type: "AJUSTE",
            quantity: a.delta,
            reason: `${AJUSTE_TAG}:${a.sku} inv06+compras-ventas → stock ${a.to}`,
            productId: a.productId,
            userId: member.userId,
            tenantId: ORG_ID,
          },
        });
        await tx.product.update({
          where: { id: a.productId },
          data: { stock: a.to },
        });
      });
      applied++;
    }

    const negatives = await prisma.product.count({
      where: { organizationId: ORG_ID, isActive: true, stock: { lt: 0 } },
    });
    console.log(`\nAjustes aplicados: ${applied}`);
    console.log(`Stock negativo restante: ${negatives}`);
    console.log("Listo.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
