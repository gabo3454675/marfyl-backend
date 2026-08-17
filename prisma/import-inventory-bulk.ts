/**
 * Importa inventario desde Excel con formatos personalizados
 * (estándar Marfyl / MonddY / El Rancho / hoja Inventario).
 *
 * Uso:
 *   pnpm import:inventory -- --org=monddy --file="C:\path\inventario.xlsx"
 *   pnpm import:inventory -- --org=el-rancho-de-german --file="C:\path\inventario.xlsx"
 *   pnpm import:inventory -- --org=monddy --file="ruta.xlsx" --format=standard
 *   pnpm import:inventory -- --org=monddy --file="ruta.xlsx" --allow-zero-price --skus=SKU1,SKU2
 *
 * Preferencia de hoja: "Inventario" si existe; si no, la primera hoja.
 * Staging guard (monddy): DATABASE_URL debe contener ep-curly-star; aborta si ep-super-art.
 * --allow-zero-price: incluye filas con PRECIO VENTA 0 / vacío / inválido (se fuerza a 0).
 * --skus=a,b,c: limita el upsert a esos SKUs (case-insensitive).
 */
import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';
import { resolveImportSalePrice } from '../src/common/import-inventory-price';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const STAGING_HOST_MARKER = 'ep-curly-star';
const PROD_HOST_MARKER = 'ep-super-art';

function assertStagingDatabaseUrl(databaseUrl: string | undefined, orgSlug: string): void {
  if (orgSlug !== 'monddy') return;
  const url = (databaseUrl ?? '').toLowerCase();
  if (url.includes(PROD_HOST_MARKER)) {
    throw new Error(
      `[import-inventory] Abortado: DATABASE_URL apunta a producción (${PROD_HOST_MARKER}). ` +
        `Usa staging (${STAGING_HOST_MARKER}).`,
    );
  }
  if (!url.includes(STAGING_HOST_MARKER)) {
    throw new Error(
      `[import-inventory] Abortado: DATABASE_URL debe contener ${STAGING_HOST_MARKER} para monddy.`,
    );
  }
}

const prisma = new PrismaClient();

type ImportFormat = 'standard' | 'monddy' | 'rancho' | 'inventario';

type ImportRow = {
  sku: string;
  name: string;
  price: number;
  costPrice: number;
  stock: number;
  description: string | null;
  barcode: string | null;
  isExempt: boolean;
};

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toUpperCase()
    .slice(0, 20);
}

function parseNumber(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return value;
  const s = String(value).replace(',', '.').trim();
  return parseFloat(s);
}

function parseIntSafe(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Math.trunc(value);
  return parseInt(String(value).trim(), 10) || 0;
}

function parseSkuFilter(raw: string | undefined): Set<string> | null {
  if (!raw?.trim()) return null;
  const skus = raw
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return skus.length ? new Set(skus) : null;
}

function skuAllowed(sku: string, filter: Set<string> | null): boolean {
  if (!filter) return true;
  return filter.has(sku.toUpperCase());
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
}

function readHeaderCells(ws: ExcelJS.Worksheet, rowNum: number, maxCol = 12): string[] {
  const row = ws.getRow(rowNum);
  const headers: string[] = [];
  for (let c = 1; c <= maxCol; c++) {
    headers.push(normalizeHeader(row.getCell(c).value));
  }
  while (headers.length > 0 && headers[headers.length - 1] === '') {
    headers.pop();
  }
  return headers;
}

/** Prefer sheet named Inventario; otherwise first worksheet. */
export function pickInventoryWorksheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  return wb.getWorksheet('Inventario') ?? wb.worksheets[0];
}

/** Plantilla Marfyl: SKU | NOMBRE | COSTO | PRECIO_VENTA | STOCK | CODIGO_BARRAS */
export function isStandardMarfylHeaders(headers: string[]): boolean {
  const norm = headers.map((h) => normalizeHeader(h));
  const has = (needle: string) =>
    norm.some((h) => h === needle || h.includes(needle));
  const hasPrecioVenta =
    has('precio venta') || has('precio_venta') || norm.some((h) => h === 'precio venta');
  return hasPrecioVenta && has('costo') && has('stock');
}

/** Hoja Inventario: SKU | NOMBRE DEL PRODUCTO | COSTO | PRECIO VENTA | GANANCIA | STOCK | DESCRIPCION | EXENTO */
export function isInventarioSheetHeaders(headers: string[]): boolean {
  const norm = headers.map((h) => normalizeHeader(h));
  const has = (needle: string) => norm.some((h) => h === needle || h.includes(needle));
  return (
    has('sku') &&
    (has('precio venta') || has('precio_venta')) &&
    has('costo') &&
    has('stock') &&
    (has('ganancia') || has('nombre del producto') || has('descripcion') || has('exento'))
  );
}

async function detectImportFormat(filePath: string): Promise<ImportFormat> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = pickInventoryWorksheet(wb);
  if (!ws) return 'rancho';

  const row1 = readHeaderCells(ws, 1);
  const h5 = normalizeHeader(row1[4] ?? '');
  const h6 = normalizeHeader(row1[5] ?? '');

  // Inventario sheet: col E = GANANCIA, col F = STOCK
  if (
    (ws.name === 'Inventario' || isInventarioSheetHeaders(row1)) &&
    (h5.includes('ganancia') || h6.includes('stock'))
  ) {
    return 'inventario';
  }

  if (isStandardMarfylHeaders(row1)) return 'standard';
  if (filePath.toLowerCase().includes('monddy')) return 'monddy';
  return 'rancho';
}

/**
 * Formato estándar Marfyl:
 * A=SKU, B=NOMBRE, C=COSTO, D=PRECIO_VENTA, E=STOCK, F=CODIGO_BARRAS
 * Omite filas sin sku/nombre o con salePrice NaN/<=0 (salvo allowZeroPrice).
 */
async function parseStandardMarfylFile(
  filePath: string,
  opts: { allowZeroPrice?: boolean; skuFilter?: Set<string> | null } = {},
): Promise<ImportRow[]> {
  const allowZeroPrice = opts.allowZeroPrice === true;
  const skuFilter = opts.skuFilter ?? null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = pickInventoryWorksheet(wb);
  const map = new Map<string, ImportRow>();

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = String(row.getCell(1).value ?? '').trim();
    const name = String(row.getCell(2).value ?? '').trim();
    const costPrice = parseNumber(row.getCell(3).value);
    const price = resolveImportSalePrice(row.getCell(4).value, allowZeroPrice);
    const stock = parseIntSafe(row.getCell(5).value);
    const barcodeRaw = String(row.getCell(6).value ?? '').trim();
    const barcode = barcodeRaw || null;

    if (!sku || !name) continue;
    if (!skuAllowed(sku, skuFilter)) continue;
    if (price === null) continue;

    const key = sku.toUpperCase();
    const existing = map.get(key);
    if (existing) {
      existing.stock += Math.max(0, stock);
      if (!Number.isNaN(costPrice) && costPrice > 0) existing.costPrice = costPrice;
      existing.name = name;
      if (barcode) existing.barcode = barcode;
    } else {
      map.set(key, {
        sku,
        name,
        price,
        costPrice: Number.isNaN(costPrice) || costPrice < 0 ? 0 : costPrice,
        stock: Math.max(0, stock),
        description: null,
        barcode,
        isExempt: false,
      });
    }
  }

  return Array.from(map.values());
}

/**
 * Hoja Inventario:
 * A=SKU, B=NOMBRE DEL PRODUCTO, C=COSTO, D=PRECIO VENTA,
 * E=GANANCIA, F=STOCK, G=DESCRIPCION, H=EXENTO
 * Omite filas sin sku/nombre o con PRECIO VENTA NaN/<=0 (salvo allowZeroPrice).
 */
async function parseInventarioSheetFile(
  filePath: string,
  opts: { allowZeroPrice?: boolean; skuFilter?: Set<string> | null } = {},
): Promise<ImportRow[]> {
  const allowZeroPrice = opts.allowZeroPrice === true;
  const skuFilter = opts.skuFilter ?? null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = pickInventoryWorksheet(wb);
  if (!ws) return [];

  const map = new Map<string, ImportRow>();

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = String(row.getCell(1).value ?? '').trim();
    const name = String(row.getCell(2).value ?? '').trim();
    const costPrice = parseNumber(row.getCell(3).value);
    const price = resolveImportSalePrice(row.getCell(4).value, allowZeroPrice);
    const stock = parseIntSafe(row.getCell(6).value);
    const description = String(row.getCell(7).value ?? '').trim() || null;
    const exento = String(row.getCell(8).value ?? '').trim().toUpperCase();

    if (!sku || !name) continue;
    if (!skuAllowed(sku, skuFilter)) continue;
    if (price === null) continue;

    const key = sku.toUpperCase();
    const existing = map.get(key);
    if (existing) {
      existing.stock += Math.max(0, stock);
      if (!Number.isNaN(costPrice) && costPrice > 0) existing.costPrice = costPrice;
      existing.name = name;
      if (description) existing.description = description;
      existing.isExempt = exento === 'SI';
    } else {
      map.set(key, {
        sku,
        name,
        price,
        costPrice: Number.isNaN(costPrice) || costPrice < 0 ? 0 : costPrice,
        stock: Math.max(0, stock),
        description,
        barcode: null,
        isExempt: exento === 'SI',
      });
    }
  }

  return Array.from(map.values());
}

/** Formato MonddY: headers en fila 2. Col B = familia/categoría, col H = nombre real del producto. */
async function parseMonddyFile(
  filePath: string,
  opts: { allowZeroPrice?: boolean; skuFilter?: Set<string> | null } = {},
): Promise<ImportRow[]> {
  const allowZeroPrice = opts.allowZeroPrice === true;
  const skuFilter = opts.skuFilter ?? null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const map = new Map<string, ImportRow>();

  for (let rowNum = 3; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = String(row.getCell(1).value ?? '').trim();
    const category = String(row.getCell(2).value ?? '').trim();
    const costPrice = parseNumber(row.getCell(3).value);
    const price = resolveImportSalePrice(row.getCell(4).value, allowZeroPrice);
    const stock = parseIntSafe(row.getCell(7).value);
    const productName = String(row.getCell(8).value ?? '').trim();

    // MonddY: la descripción (col H) es el nombre comercial; col B es solo la familia (ej. HELADO)
    const name = productName || category;
    const description =
      productName && category && productName !== category ? category : productName ? null : category || null;

    if (!sku || !name) continue;
    if (!skuAllowed(sku, skuFilter)) continue;
    if (price === null) continue;

    const key = sku.toUpperCase();
    const existing = map.get(key);
    if (existing) {
      existing.stock += stock;
      if (costPrice > 0) existing.costPrice = costPrice;
      existing.name = name;
      existing.description = description;
    } else {
      map.set(key, {
        sku,
        name,
        price,
        costPrice: Number.isNaN(costPrice) ? 0 : costPrice,
        stock: Math.max(0, stock),
        description,
        barcode: null,
        isExempt: false,
      });
    }
  }

  return Array.from(map.values());
}

/** Formato Rancho con SKUs duplicados (col3=precio, col4=stock) */
async function parseRanchoFile(
  filePath: string,
  opts: { allowZeroPrice?: boolean; skuFilter?: Set<string> | null } = {},
): Promise<ImportRow[]> {
  const allowZeroPrice = opts.allowZeroPrice === true;
  const skuFilter = opts.skuFilter ?? null;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows: ImportRow[] = [];

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const rawSku = String(row.getCell(1).value ?? '').trim();
    const name = String(row.getCell(2).value ?? '').trim();
    // Rancho ya permitía price=0; allowZeroPrice también fuerza NaN/<0 → 0
    let price = parseNumber(row.getCell(3).value);
    if (Number.isNaN(price) || price < 0) {
      if (!allowZeroPrice) continue;
      price = 0;
    }
    const stock = parseIntSafe(row.getCell(4).value);
    const description = String(row.getCell(5).value ?? '').trim() || null;
    const exento = String(row.getCell(6).value ?? '').trim().toUpperCase();

    if (!name) continue;

    const sku =
      rawSku && rawSku !== 'ABC-001'
        ? rawSku
        : `RN-${String(rowNum - 1).padStart(3, '0')}-${slugify(name)}`;

    if (!skuAllowed(sku, skuFilter)) continue;

    rows.push({
      sku,
      name,
      price,
      costPrice: 0,
      stock: Math.max(0, stock),
      description,
      barcode: null,
      isExempt: exento === 'SI',
    });
  }

  return rows;
}

async function getCompanyId(organizationId: number): Promise<number> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { nombre: true },
  });
  if (!organization) throw new Error(`Organización ${organizationId} no encontrada`);

  const company = await prisma.company.findFirst({
    where: { name: organization.nombre },
    select: { id: true },
  });
  if (company) return company.id;

  const newCompany = await prisma.company.create({
    data: {
      name: organization.nombre,
      taxId: `J-${Math.floor(Math.random() * 10000000)}-${Math.floor(Math.random() * 10)}`,
      currency: 'USD',
      isActive: true,
    },
    select: { id: true },
  });
  return newCompany.id;
}

async function importRows(organizationId: number, rows: ImportRow[]) {
  const companyId = await getCompanyId(organizationId);
  const skus = rows.map((r) => r.sku);
  const existing = await prisma.product.findMany({
    where: { organizationId, sku: { in: skus } },
    select: { sku: true },
  });
  const existingSet = new Set(existing.map((e) => (e.sku ?? '').toUpperCase()));

  const toCreate = rows.filter((r) => !existingSet.has(r.sku.toUpperCase()));
  const toUpdate = rows.filter((r) => existingSet.has(r.sku.toUpperCase()));

  let created = 0;
  if (toCreate.length) {
    const res = await prisma.product.createMany({
      data: toCreate.map((r) => ({
        companyId,
        organizationId,
        sku: r.sku,
        name: r.name,
        description: r.description,
        barcode: r.barcode,
        salePrice: r.price,
        costPrice: r.costPrice,
        stock: r.stock,
        minStock: 5,
        isExempt: r.isExempt,
      })),
    });
    created = res.count;
  }

  // Actualizaciones en lotes (evita timeout de transacción en Neon con muchos SKUs)
  const BATCH = 40;
  for (let i = 0; i < toUpdate.length; i += BATCH) {
    const batch = toUpdate.slice(i, i + BATCH);
    await Promise.all(
      batch.map((r) =>
        prisma.product.updateMany({
          where: { organizationId, sku: r.sku },
          data: {
            name: r.name,
            description: r.description,
            barcode: r.barcode,
            salePrice: r.price,
            costPrice: r.costPrice,
            stock: r.stock,
            isExempt: r.isExempt,
          },
        }),
      ),
    );
    if (toUpdate.length > BATCH) {
      console.log(`   Progreso: ${Math.min(i + BATCH, toUpdate.length)}/${toUpdate.length} actualizados`);
    }
  }

  return { created, updated: toUpdate.length };
}

async function main() {
  const args = process.argv.slice(2);
  const orgSlug = args.find((a) => a.startsWith('--org='))?.split('=')[1];
  const fileArg = args.find((a) => a.startsWith('--file='))?.split('=').slice(1).join('=');
  const formatArg = args.find((a) => a.startsWith('--format='))?.split('=')[1] ?? 'auto';
  const allowZeroPrice = args.includes('--allow-zero-price');
  const skuFilter = parseSkuFilter(args.find((a) => a.startsWith('--skus='))?.split('=').slice(1).join('='));
  const parseOpts = { allowZeroPrice, skuFilter };

  if (!orgSlug || !fileArg) {
    console.error(
      'Uso: pnpm import:inventory -- --org=monddy --file="ruta.xlsx" [--format=standard|inventario|monddy|rancho|auto] [--allow-zero-price] [--skus=SKU1,SKU2]',
    );
    process.exit(1);
  }

  assertStagingDatabaseUrl(process.env.DATABASE_URL, orgSlug);

  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`Archivo no encontrado: ${filePath}`);
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ where: { slug: orgSlug } });
  if (!org) {
    console.error(`Organización no encontrada: ${orgSlug}`);
    process.exit(1);
  }

  const detectedFormat: ImportFormat =
    formatArg === 'auto'
      ? await detectImportFormat(filePath)
      : (formatArg as ImportFormat);

  if (!['standard', 'inventario', 'monddy', 'rancho'].includes(detectedFormat)) {
    console.error(`Formato no soportado: ${formatArg}`);
    process.exit(1);
  }

  console.log(`📦 Importando a "${org.nombre}" (id=${org.id}) desde ${filePath}`);
  console.log(`   Formato: ${detectedFormat}`);
  console.log(`   DB host check: staging OK (${STAGING_HOST_MARKER})`);
  if (allowZeroPrice) console.log('   allow-zero-price: ON (precio 0/vacío/inválido → 0)');
  if (skuFilter) console.log(`   Filtro SKUs: ${[...skuFilter].join(', ')}`);

  const rows =
    detectedFormat === 'inventario'
      ? await parseInventarioSheetFile(filePath, parseOpts)
      : detectedFormat === 'standard'
        ? await parseStandardMarfylFile(filePath, parseOpts)
        : detectedFormat === 'monddy'
          ? await parseMonddyFile(filePath, parseOpts)
          : await parseRanchoFile(filePath, parseOpts);

  console.log(`   Filas válidas: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `   · ${r.sku} | ${r.name} | sale=${r.price} cost=${r.costPrice} stock=${r.stock} exempt=${r.isExempt}`,
    );
  }

  if (rows.length === 0) {
    console.error('No hay filas válidas para importar.');
    process.exit(1);
  }

  const result = await importRows(org.id, rows);
  console.log(`✅ Importación completada: ${result.created} creados, ${result.updated} actualizados`);

  const totalMonddy = await prisma.product.count({ where: { organizationId: org.id } });
  console.log(`📊 Total productos monddy (organizationId=${org.id}): ${totalMonddy}`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
