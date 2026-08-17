/**
 * Fill missing PRECIO VENTA on the Inventario sheet from Hybrid prices.
 * Source of truth for which products: Inventario rows only (never add Hybrid-only SKUs).
 *
 *   Dry-run (default):
 *     ./node_modules/.bin/tsx scripts/fill-prices-from-hybrid.ts
 *
 *   Apply (backup + write Excel + short JSON log):
 *     ./node_modules/.bin/tsx scripts/fill-prices-from-hybrid.ts --apply
 */
import "dotenv/config";
import * as ExcelJS from "exceljs";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const APPLY = process.argv.includes("--apply");

const WORK_FILE =
  "/home/alvarovargas/Downloads/INVENTARIO REALLL_con_precios.xlsx";
const LOG_FILE =
  "/home/alvarovargas/Downloads/INVENTARIO REALLL_con_precios_fill_log.json";
const BULK_CACHE_FILE = "/tmp/hybrid-prices-tipo1.json";

const HYBRID_BASE_URL =
  process.env.HYBRID_API_BASE_URL || "https://db.marfyl.site";
const HYBRID_API_TOKEN = process.env.HYBRID_API_TOKEN || "";

const API_DELAY_MS = 1500;
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_BACKOFF_MS = 2000;

const SHEET_INVENTARIO = "Inventario";
const SHEET_PRODUCTOS = "Productos";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") return NaN;
  if (typeof value === "number") return value;
  const s = String(value).replace(",", ".").trim();
  return parseFloat(s);
}

function normalizeSku(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasValidPrice(n: number): boolean {
  return !Number.isNaN(n) && n > 0;
}

function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function backupFile(filePath: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(dir, `${base}.bak-${stamp}${ext}`);
  fs.copyFileSync(filePath, backupPath);
  return backupPath;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RowData = {
  rowNum: number;
  sku: string;
  nombre: string;
  costo: number;
  precioVenta: number;
  ganancia: number;
};

type FillSource = "bulk_cache" | "productos_sheet" | "hybrid_api";

type ChangeEntry = {
  sku: string;
  action: "filled" | "skipped_no_price" | "skipped_error";
  source?: FillSource;
  oldPrice: number | null;
  newPrice: number | null;
  error?: string;
};

type LogData = {
  timestamp: string;
  inputFile: string;
  backupFile: string | null;
  summary: {
    total: number;
    withPriceBefore: number;
    withoutPriceBefore: number;
    withPriceAfter: number;
    filled: number;
    notFound: number;
    errors: number;
    filledFromBulk: number;
    filledFromProductos: number;
    filledFromApi: number;
  };
  remainingWithoutPrice: string[];
  changes: ChangeEntry[];
};

// ---------------------------------------------------------------------------
// Price maps
// ---------------------------------------------------------------------------
function loadBulkCache(filePath: string): Map<string, number> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const map = new Map<string, number>();
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const sku = normalizeSku(key);
      const price = parseNumber(value);
      if (sku && hasValidPrice(price)) map.set(sku, price);
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function loadProductosPrices(wb: ExcelJS.Workbook): Map<string, number> {
  const map = new Map<string, number>();
  const ws = wb.getWorksheet(SHEET_PRODUCTOS);
  if (!ws) return map;

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = normalizeSku(row.getCell(1).value);
    const price = parseNumber(row.getCell(4).value);
    if (sku && hasValidPrice(price)) map.set(sku, price);
  }
  return map;
}

function parseInventarioRows(ws: ExcelJS.Worksheet): RowData[] {
  const rows: RowData[] = [];
  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = normalizeSku(row.getCell(1).value);
    if (!sku) continue;

    rows.push({
      rowNum,
      sku,
      nombre: String(row.getCell(2).value ?? "").trim(),
      costo: parseNumber(row.getCell(3).value),
      precioVenta: parseNumber(row.getCell(4).value),
      ganancia: parseNumber(row.getCell(5).value),
    });
  }
  return rows;
}

/**
 * Prefer TPC_TIPO === 1, field TPC_PVPCONIMPUESTO1.
 * Match SKU with trim+toUpperCase (Hybrid may have leading spaces).
 */
function selectPriceFromItems(
  items: unknown[],
  sku: string,
): { price: number | null; error?: string } {
  const target = normalizeSku(sku);
  const exactMatches = items.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return normalizeSku(row.TPC_CODIGOPRODUCTO) === target;
  }) as Record<string, unknown>[];

  if (exactMatches.length === 0) {
    return { price: null, error: "No items found" };
  }

  const tipo1Matches = exactMatches.filter(
    (row) => Number(row.TPC_TIPO) === 1,
  );
  const tipo1 =
    tipo1Matches.find((row) => {
      const raw = String(row.TPC_CODIGOPRODUCTO ?? "");
      return raw !== raw.trim();
    }) ?? tipo1Matches[0];
  const candidates = tipo1 ? [tipo1] : exactMatches;

  for (const row of candidates) {
    const rawPrice = row.TPC_PVPCONIMPUESTO1;
    if (rawPrice === null || rawPrice === undefined || rawPrice === "") {
      continue;
    }
    const price = parseNumber(rawPrice);
    if (hasValidPrice(price)) return { price };
  }

  const sample = candidates[0]?.TPC_PVPCONIMPUESTO1;
  if (sample === null || sample === undefined || sample === "") {
    return { price: null, error: "TPC_PVPCONIMPUESTO1 is empty" };
  }
  return {
    price: null,
    error: `TPC_PVPCONIMPUESTO1 is not positive: ${sample}`,
  };
}

type FetchPriceResult = {
  price: number | null;
  error?: string;
};

async function fetchHybridPrice(sku: string): Promise<FetchPriceResult> {
  const endpoint = `/tablas/TCostoPrecioInv?q=${encodeURIComponent(sku)}&limit=10`;
  const url = `${HYBRID_BASE_URL}${endpoint}`;

  try {
    let res: Response | null = null;
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt++) {
      res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${HYBRID_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (res.status !== 429) break;
      if (attempt < RATE_LIMIT_MAX_RETRIES) {
        await sleep(RATE_LIMIT_BASE_BACKOFF_MS * Math.pow(2, attempt));
      }
    }

    if (!res) return { price: null, error: "No response" };
    if (!res.ok) return { price: null, error: `HTTP ${res.status}` };

    const data = (await res.json()) as Record<string, unknown>;
    const items = data.items;
    if (!Array.isArray(items)) {
      return { price: null, error: "Unexpected API response: items not array" };
    }
    if (items.length === 0) return { price: null, error: "No items found" };

    return selectPriceFromItems(items, sku);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { price: null, error: msg };
  }
}

function resolveFromCaches(
  sku: string,
  bulk: Map<string, number> | null,
  productos: Map<string, number>,
): { price: number; source: FillSource } | null {
  const fromBulk = bulk?.get(sku);
  if (fromBulk != null && hasValidPrice(fromBulk)) {
    return { price: fromBulk, source: "bulk_cache" };
  }
  const fromProductos = productos.get(sku);
  if (fromProductos != null && hasValidPrice(fromProductos)) {
    return { price: fromProductos, source: "productos_sheet" };
  }
  return null;
}

function applyPriceToRow(
  ws: ExcelJS.Worksheet,
  row: RowData,
  price: number,
): void {
  const excelRow = ws.getRow(row.rowNum);
  excelRow.getCell(4).value = price;

  // Keep GANANCIA consistent when COSTO is available.
  if (hasValidPrice(row.costo)) {
    const marginPct = ((price - row.costo) / row.costo) * 100;
    excelRow.getCell(5).value = Math.round(marginPct * 100) / 100;
  }

  excelRow.commit();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log("\n=== Fill Inventario PRECIO VENTA from Hybrid ===");
  console.log(`Excel: ${WORK_FILE}`);
  console.log(
    `Mode: ${APPLY ? "APPLY (backup + write)" : "DRY-RUN (no files written)"}`,
  );

  if (!fs.existsSync(WORK_FILE)) {
    console.error(`\n❌ Excel file not found: ${WORK_FILE}`);
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(WORK_FILE);
  const invWs = wb.getWorksheet(SHEET_INVENTARIO);
  if (!invWs) {
    console.error(`\n❌ Sheet "${SHEET_INVENTARIO}" not found`);
    process.exit(1);
  }

  const rows = parseInventarioRows(invWs);
  const withoutPrice = rows.filter((r) => !hasValidPrice(r.precioVenta));
  const withPriceBefore = rows.length - withoutPrice.length;

  console.log(`Inventario products: ${rows.length}`);
  console.log(`With PRECIO VENTA: ${withPriceBefore}`);
  console.log(`Missing PRECIO VENTA: ${withoutPrice.length}`);

  const bulk = loadBulkCache(BULK_CACHE_FILE);
  console.log(
    bulk
      ? `Bulk cache: ${BULK_CACHE_FILE} (${bulk.size} SKUs)`
      : `Bulk cache: missing/invalid — will query API for remaining`,
  );

  const productos = loadProductosPrices(wb);
  console.log(`Productos helper prices: ${productos.size}`);

  const changes: ChangeEntry[] = [];
  let filled = 0;
  let notFound = 0;
  let errors = 0;
  let filledFromBulk = 0;
  let filledFromProductos = 0;
  let filledFromApi = 0;

  const needApi: RowData[] = [];

  for (const row of withoutPrice) {
    const cached = resolveFromCaches(row.sku, bulk, productos);
    if (cached) {
      filled++;
      if (cached.source === "bulk_cache") filledFromBulk++;
      else filledFromProductos++;

      changes.push({
        sku: row.sku,
        action: "filled",
        source: cached.source,
        oldPrice: hasValidPrice(row.precioVenta) ? row.precioVenta : 0,
        newPrice: cached.price,
      });

      if (APPLY) applyPriceToRow(invWs, row, cached.price);
      row.precioVenta = cached.price;
      continue;
    }
    needApi.push(row);
  }

  console.log(`\nResolved from caches: ${filled}`);
  console.log(`Need Hybrid API: ${needApi.length}`);

  if (needApi.length > 0 && !HYBRID_API_TOKEN) {
    console.error("\n❌ HYBRID_API_TOKEN not set — cannot query remaining SKUs");
    process.exit(1);
  }

  for (let i = 0; i < needApi.length; i++) {
    const row = needApi[i];
    const idx = i + 1;
    const result = await fetchHybridPrice(row.sku);

    if (result.price != null && hasValidPrice(result.price)) {
      console.log(
        `[${idx}/${needApi.length}] SKU ${row.sku} → ${formatPrice(result.price)} (api)`,
      );
      filled++;
      filledFromApi++;
      changes.push({
        sku: row.sku,
        action: "filled",
        source: "hybrid_api",
        oldPrice: 0,
        newPrice: result.price,
      });
      if (APPLY) applyPriceToRow(invWs, row, result.price);
      row.precioVenta = result.price;
    } else if (
      result.error === "No items found" ||
      result.error === "TPC_PVPCONIMPUESTO1 is empty" ||
      result.error?.startsWith("TPC_PVPCONIMPUESTO1 is not positive")
    ) {
      console.log(
        `[${idx}/${needApi.length}] SKU ${row.sku} → not found (${result.error})`,
      );
      notFound++;
      changes.push({
        sku: row.sku,
        action: "skipped_no_price",
        oldPrice: 0,
        newPrice: null,
        error: result.error,
      });
    } else {
      console.log(
        `[${idx}/${needApi.length}] SKU ${row.sku} → ERROR: ${result.error}`,
      );
      errors++;
      changes.push({
        sku: row.sku,
        action: "skipped_error",
        oldPrice: 0,
        newPrice: null,
        error: result.error,
      });
    }

    if (i < needApi.length - 1) await sleep(API_DELAY_MS);
  }

  const withPriceAfter = rows.filter((r) => hasValidPrice(r.precioVenta)).length;
  const remainingWithoutPrice = rows
    .filter((r) => !hasValidPrice(r.precioVenta))
    .map((r) => r.sku);

  console.log("\nSummary:");
  console.log(`  With price before: ${withPriceBefore}`);
  console.log(`  Filled: ${filled} (bulk=${filledFromBulk}, productos=${filledFromProductos}, api=${filledFromApi})`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  With price after: ${withPriceAfter}`);
  if (remainingWithoutPrice.length) {
    console.log(`  Remaining without price: ${remainingWithoutPrice.join(", ")}`);
  }

  let backupPath: string | null = null;
  if (APPLY) {
    backupPath = backupFile(WORK_FILE);
    console.log(`\n✅ Backup: ${backupPath}`);
    await wb.xlsx.writeFile(WORK_FILE);
    console.log(`✅ Excel updated: ${WORK_FILE}`);
  }

  const logData: LogData = {
    timestamp: new Date().toISOString(),
    inputFile: WORK_FILE,
    backupFile: backupPath,
    summary: {
      total: rows.length,
      withPriceBefore,
      withoutPriceBefore: withoutPrice.length,
      withPriceAfter,
      filled,
      notFound,
      errors,
      filledFromBulk,
      filledFromProductos,
      filledFromApi,
    },
    remainingWithoutPrice,
    changes: changes.map((c) => ({
      sku: c.sku,
      action: c.action,
      source: c.source,
      oldPrice: c.oldPrice,
      newPrice: c.newPrice,
      error: c.error,
    })),
  };

  if (APPLY) {
    // Short operational log: keep filled/skipped counts; trim per-SKU noise to remaining + sample
    const shortLog = {
      timestamp: logData.timestamp,
      inputFile: logData.inputFile,
      backupFile: logData.backupFile,
      summary: logData.summary,
      remainingWithoutPrice: logData.remainingWithoutPrice,
      filledSkusSample: changes
        .filter((c) => c.action === "filled")
        .slice(0, 20)
        .map((c) => ({ sku: c.sku, price: c.newPrice, source: c.source })),
      notFoundOrError: changes.filter((c) => c.action !== "filled"),
    };
    fs.writeFileSync(LOG_FILE, JSON.stringify(shortLog, null, 2), "utf-8");
    console.log(`✅ Log: ${LOG_FILE}`);
  } else {
    console.log("\nRun with --apply to backup + write Excel + log.");
  }
}

main().catch((e) => {
  console.error("\n❌ Fatal error:", e);
  process.exit(1);
});
