/**
 * Importa inventario desde Excel con formatos personalizados (MonddY / El Rancho).
 *
 * Uso:
 *   pnpm import:inventory -- --org=monddy --file="C:\path\inventario.xlsx"
 *   pnpm import:inventory -- --org=el-rancho-de-german --file="C:\path\inventario.xlsx"
 */
import { PrismaClient } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

type ImportRow = {
  sku: string;
  name: string;
  price: number;
  costPrice: number;
  stock: number;
  description: string | null;
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

/** Formato MonddY: headers en fila 2. Col B = familia/categoría, col H = nombre real del producto. */
async function parseMonddyFile(filePath: string): Promise<ImportRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const map = new Map<string, ImportRow>();

  for (let rowNum = 3; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const sku = String(row.getCell(1).value ?? '').trim();
    const category = String(row.getCell(2).value ?? '').trim();
    const costPrice = parseNumber(row.getCell(3).value);
    const price = parseNumber(row.getCell(4).value);
    const stock = parseIntSafe(row.getCell(7).value);
    const productName = String(row.getCell(8).value ?? '').trim();

    // MonddY: la descripción (col H) es el nombre comercial; col B es solo la familia (ej. HELADO)
    const name = productName || category;
    const description =
      productName && category && productName !== category ? category : productName ? null : category || null;

    if (!sku || !name) continue;
    if (Number.isNaN(price) || price <= 0) continue;

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
        isExempt: false,
      });
    }
  }

  return Array.from(map.values());
}

/** Formato MARFYL estándar o Rancho con SKUs duplicados */
async function parseRanchoFile(filePath: string): Promise<ImportRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  const rows: ImportRow[] = [];

  for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    const rawSku = String(row.getCell(1).value ?? '').trim();
    const name = String(row.getCell(2).value ?? '').trim();
    const price = parseNumber(row.getCell(3).value);
    const stock = parseIntSafe(row.getCell(4).value);
    const description = String(row.getCell(5).value ?? '').trim() || null;
    const exento = String(row.getCell(6).value ?? '').trim().toUpperCase();

    if (!name) continue;
    if (Number.isNaN(price) || price < 0) continue;

    const sku =
      rawSku && rawSku !== 'ABC-001'
        ? rawSku
        : `RN-${String(rowNum - 1).padStart(3, '0')}-${slugify(name)}`;

    rows.push({
      sku,
      name,
      price,
      costPrice: 0,
      stock: Math.max(0, stock),
      description,
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
  const format = args.find((a) => a.startsWith('--format='))?.split('=')[1] ?? 'auto';

  if (!orgSlug || !fileArg) {
    console.error('Uso: pnpm import:inventory -- --org=monddy --file="ruta.xlsx" [--format=monddy|rancho|auto]');
    process.exit(1);
  }

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

  const detectedFormat =
    format === 'auto'
      ? filePath.toLowerCase().includes('monddy')
        ? 'monddy'
        : 'rancho'
      : format;

  console.log(`📦 Importando a "${org.nombre}" (id=${org.id}) desde ${filePath}`);
  console.log(`   Formato: ${detectedFormat}`);

  const rows =
    detectedFormat === 'monddy' ? await parseMonddyFile(filePath) : await parseRanchoFile(filePath);

  console.log(`   Filas válidas: ${rows.length}`);

  if (rows.length === 0) {
    console.error('No hay filas válidas para importar.');
    process.exit(1);
  }

  const result = await importRows(org.id, rows);
  console.log(`✅ Importación completada: ${result.created} creados, ${result.updated} actualizados`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
