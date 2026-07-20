/**
 * Cuadre inventario Monddy:
 *   stock teórico = inventario 06/07 + compras − ventas (hasta 19/07)
 * vs stock actual en DB.
 *
 *   pnpm exec tsx scripts/reconcile-monddy-inventory-jul6-19.ts
 */
import "dotenv/config";
import { readFileSync } from "fs";
import * as ExcelJS from "exceljs";
import { PrismaClient, InvoiceStatus } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { parseMonddyPurchasesExcel } from "../src/modules/purchases-import/monddy-purchases.parser";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const ORG_ID = 2;
const INVENTORY_FILE =
  "/home/gabdev/Descargas/FACTURAS/INVENTARIO MONDDY  06072026.xlsx";
const PURCHASES_FILE = "/home/gabdev/Descargas/FACTURAS/COMPRAS 07072026.xlsx";

/** Fin del día 19/07/2026 Venezuela (UTC-4) ≈ 20/07 04:00 UTC */
const CUTOFF_END = new Date("2026-07-20T04:00:00.000Z");
/** Inicio 06/07/2026 VE */
const INV_START = new Date("2026-07-06T04:00:00.000Z");

const TARGET_SALES: Record<string, number> = {
  "2026-07-13": 225.24,
  "2026-07-14": 276,
  "2026-07-15": 328,
  "2026-07-16": 256.07,
  "2026-07-17": 541.31,
  "2026-07-18": 522,
  "2026-07-19": 2024,
};

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
  const map = new Map<string, { sku: string; name: string; stock: number }>();

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

    const existing = map.get(sku);
    if (existing) {
      existing.stock += Math.max(0, stock);
      existing.name = name;
    } else {
      map.set(sku, { sku, name, stock: Math.max(0, stock) });
    }
  }
  return map;
}

function veDayKey(d: Date): string {
  // Venezuela UTC-4
  const shifted = new Date(d.getTime() - 4 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const initial = await parseInitialInventory(INVENTORY_FILE);
    const purchasesBuf = readFileSync(PURCHASES_FILE);
    const purchaseGroups = parseMonddyPurchasesExcel(purchasesBuf);

    const purchased = new Map<string, number>();
    let purchaseLines = 0;
    let purchaseQty = 0;
    let purchaseUsd = 0;
    for (const g of purchaseGroups) {
      for (const line of g.lines) {
        const sku = line.sku.trim().toUpperCase();
        if (!sku) continue;
        purchased.set(sku, (purchased.get(sku) ?? 0) + line.quantity);
        purchaseLines++;
        purchaseQty += line.quantity;
        purchaseUsd += line.quantity * line.unitCostUsd;
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

    // Ventas por producto hasta cutoff (todas las facturas no canceladas/borradas)
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: ORG_ID,
        deletedAt: null,
        status: { not: InvoiceStatus.CANCELLED },
        issueDate: { lt: CUTOFF_END },
      },
      select: {
        id: true,
        issueDate: true,
        totalAmount: true,
        consecutiveNumber: true,
        legacyImportKey: true,
        items: {
          select: { productId: true, quantity: true, subtotal: true },
        },
      },
    });

    const soldAll = new Map<string, number>(); // sku -> qty (all sales before cutoff)
    const soldAfterInv = new Map<string, number>(); // from inv date onward
    const soldWeek = new Map<string, number>(); // 13-19
    const salesByDay = new Map<string, number>();

    for (const inv of invoices) {
      const day = veDayKey(inv.issueDate);
      const total = Number(inv.totalAmount);
      salesByDay.set(day, (salesByDay.get(day) ?? 0) + total);

      for (const item of inv.items) {
        const p = byId.get(item.productId);
        if (!p?.sku || p.isBundle || p.isService) continue;
        const sku = p.sku.trim().toUpperCase();
        soldAll.set(sku, (soldAll.get(sku) ?? 0) + item.quantity);
        if (inv.issueDate >= INV_START) {
          soldAfterInv.set(sku, (soldAfterInv.get(sku) ?? 0) + item.quantity);
        }
        if (day >= "2026-07-13" && day <= "2026-07-19") {
          soldWeek.set(sku, (soldWeek.get(sku) ?? 0) + item.quantity);
        }
      }
    }

    // Movimientos COMPRA en DB
    const movements = await prisma.inventoryMovement.findMany({
      where: { tenantId: ORG_ID, type: "COMPRA" },
      select: { productId: true, quantity: true, createdAt: true, reason: true },
    });
    const purchasedDb = new Map<string, number>();
    for (const m of movements) {
      const p = byId.get(m.productId);
      if (!p?.sku) continue;
      const sku = p.sku.trim().toUpperCase();
      purchasedDb.set(sku, (purchasedDb.get(sku) ?? 0) + m.quantity);
    }

    type Row = {
      sku: string;
      name: string;
      initial: number;
      purchasedXls: number;
      purchasedDb: number;
      sold: number;
      expected: number;
      actual: number;
      delta: number;
    };

    const skus = new Set<string>([
      ...initial.keys(),
      ...purchased.keys(),
      ...soldAfterInv.keys(),
      ...bySku.keys(),
    ]);

    const rows: Row[] = [];
    for (const sku of skus) {
      const init = initial.get(sku)?.stock ?? 0;
      const buyX = purchased.get(sku) ?? 0;
      const buyDb = purchasedDb.get(sku) ?? 0;
      const sold = soldAfterInv.get(sku) ?? 0;
      // Teórico: inventario 6 jul + compras Excel − ventas desde 6 jul
      const expected = init + buyX - sold;
      const prod = bySku.get(sku);
      const actual = prod?.stock ?? 0;
      const name =
        initial.get(sku)?.name || prod?.name || purchased.has(sku)
          ? (prod?.name ?? initial.get(sku)?.name ?? sku)
          : sku;
      rows.push({
        sku,
        name: prod?.name ?? initial.get(sku)?.name ?? sku,
        initial: init,
        purchasedXls: buyX,
        purchasedDb: buyDb,
        sold,
        expected,
        actual,
        delta: actual - expected,
      });
    }

    rows.sort((a, b) => a.delta - b.delta || a.expected - b.expected);

    const negatives = products
      .filter((p) => p.stock < 0)
      .sort((a, b) => a.stock - b.stock);

    const mismatch = rows.filter((r) => r.delta !== 0);
    const expectedNeg = rows.filter((r) => r.expected < 0);
    const actualNegVsExpected = rows.filter(
      (r) => r.actual < 0 && r.expected >= 0,
    );

    console.log("\n========== VENTAS POR DÍA (DB vs WhatsApp) ==========");
    let weekDb = 0;
    let weekTarget = 0;
    for (const [day, target] of Object.entries(TARGET_SALES)) {
      const db = Math.round((salesByDay.get(day) ?? 0) * 100) / 100;
      weekDb += db;
      weekTarget += target;
      const ok = Math.abs(db - target) < 0.02 ? "OK" : "DIFF";
      console.log(
        `${day}: DB=${db.toFixed(2)}  WA=${target.toFixed(2)}  [${ok}]`,
      );
    }
    console.log(
      `Semana 13-19: DB=${weekDb.toFixed(2)}  WA=${weekTarget.toFixed(2)}  (caja oficina 759$ NO modelada)`,
    );

    // Otros días con ventas
    const otherDays = [...salesByDay.entries()]
      .filter(([d]) => d < "2026-07-13" || d > "2026-07-19")
      .sort(([a], [b]) => a.localeCompare(b));
    if (otherDays.length) {
      console.log("\n--- Otras fechas con ventas en DB ---");
      for (const [d, v] of otherDays) {
        console.log(`${d}: ${v.toFixed(2)}`);
      }
    }

    console.log("\n========== FUENTES ==========");
    console.log(`Inventario inicial: ${INVENTORY_FILE}`);
    console.log(`  SKUs: ${initial.size}  unidades: ${[...initial.values()].reduce((s, r) => s + r.stock, 0)}`);
    console.log(`Compras Excel: ${PURCHASES_FILE}`);
    console.log(
      `  grupos: ${purchaseGroups.length}  líneas: ${purchaseLines}  qty: ${purchaseQty}  costo≈$${purchaseUsd.toFixed(2)}`,
    );
    console.log(
      `Compras DB (InventoryMovement COMPRA): ${movements.length} movs, qty ${[...purchasedDb.values()].reduce((a, b) => a + b, 0)}`,
    );
    console.log(
      `Facturas hasta < ${CUTOFF_END.toISOString()}: ${invoices.length}`,
    );
    console.log(`Productos activos Monddy: ${products.length}`);
    console.log(`Stock negativo en DB: ${negatives.length}`);

    console.log("\n========== STOCK NEGATIVO EN SISTEMA (top 40) ==========");
    for (const p of negatives.slice(0, 40)) {
      const sku = (p.sku ?? "").toUpperCase();
      const r = rows.find((x) => x.sku === sku);
      console.log(
        `${String(p.stock).padStart(5)} | ${sku.padEnd(14)} | ${(p.name ?? "").slice(0, 40).padEnd(40)} | teórico=${r?.expected ?? "?"} (ini ${r?.initial ?? 0}+compra ${r?.purchasedXls ?? 0}-venta ${r?.sold ?? 0})`,
      );
    }
    if (negatives.length > 40) console.log(`... +${negatives.length - 40} más`);

    console.log(
      "\n========== TEÓRICO NEGATIVO (ini+compra-venta < 0) — top 30 ==========",
    );
    expectedNeg
      .sort((a, b) => a.expected - b.expected)
      .slice(0, 30)
      .forEach((r) => {
        console.log(
          `esp ${String(r.expected).padStart(5)} act ${String(r.actual).padStart(5)} Δ${String(r.delta).padStart(4)} | ${r.sku.padEnd(14)} | ini ${r.initial} +c ${r.purchasedXls} -v ${r.sold} | ${r.name.slice(0, 36)}`,
        );
      });

    console.log(
      `\n========== DESCUADRE STOCK (actual ≠ teórico) — ${mismatch.length} SKUs ==========`,
    );
    const big = mismatch
      .slice()
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 50);
    for (const r of big) {
      console.log(
        `Δ ${String(r.delta).padStart(5)} | act ${String(r.actual).padStart(5)} esp ${String(r.expected).padStart(5)} | ${r.sku.padEnd(14)} | ini ${r.initial} +c ${r.purchasedXls}(db ${r.purchasedDb}) -v ${r.sold} | ${r.name.slice(0, 32)}`,
      );
    }

    console.log("\n========== RESUMEN ==========");
    console.log(`SKUs con descuadre: ${mismatch.length}`);
    console.log(`SKUs con teórico negativo: ${expectedNeg.length}`);
    console.log(
      `Negativos en DB pero teórico ≥0 (solo error de import/orden): ${actualNegVsExpected.length}`,
    );
    console.log(
      `Suma Δ stock (actual-teórico): ${rows.reduce((s, r) => s + r.delta, 0)}`,
    );
    console.log(
      `Suma stock actual: ${products.reduce((s, p) => s + p.stock, 0)}`,
    );
    console.log(
      `Suma stock teórico: ${rows.reduce((s, r) => s + r.expected, 0)}`,
    );

    // Diagnóstico: ventas sin producto en inventario inicial ni compra
    const soldUnknown = [...soldAfterInv.entries()].filter(
      ([sku]) => !initial.has(sku) && !purchased.has(sku),
    );
    console.log(
      `\nVendidos sin estar en inv 06/07 ni en compras Excel: ${soldUnknown.length} SKUs`,
    );
    soldUnknown
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25)
      .forEach(([sku, qty]) => {
        const p = bySku.get(sku);
        console.log(
          `  -v ${qty} | ${sku.padEnd(14)} | stock act ${p?.stock ?? "?"} | ${p?.name?.slice(0, 40) ?? ""}`,
        );
      });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
