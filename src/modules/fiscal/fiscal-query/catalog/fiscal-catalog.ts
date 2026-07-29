import { createHash } from "crypto";
import { getMetadataStorage, ValidationTypes } from "class-validator";
import { Role } from "@prisma/client";
import {
  CatalogEntryParamsField,
  CatalogEntryResponse,
  FiscalCatalogEntry,
  FiscalQueryRunnerContext,
} from "./fiscal-catalog.types";
import {
  VatDebtsByMonthParamsDto,
  WithholdingSummaryBySupplierParamsDto,
} from "./fiscal-catalog.params.dto";

/**
 * Catálogo allow-list de queries fiscales (código versionado).
 *
 * Principios:
 * - Solo las entradas aquí listadas pueden ejecutarse vía POST /fiscal/query.
 * - Cada entrada declara sus roles permitidos (RBAC por entrada).
 * - Cada entrada declara su DTO de params (class-validator) — validación
 *   estricta antes de tocar la BD.
 * - Los runners usan Prisma parametrizada (findMany / groupBy). NUNCA
 *   $queryRawUnsafe (regla ESLint TASK-B3).
 *
 * Adaptación de roles: el enum `Role` del schema no incluye `ACCOUNTANT`.
 * El rol fiscal equivalente en Marfyl es `FISCAL`. Por eso las entradas
 * declaran [ADMIN, FISCAL] en lugar de [ADMIN, ACCOUNTANT].
 */

type VatRow = {
  month: number;
  debit: number;
  credit: number;
  net: number;
};

async function runVatDebtsByMonth(
  ctx: FiscalQueryRunnerContext,
): Promise<VatRow[]> {
  const { prisma, organizationId, params, rowCap } = ctx;
  const year = params.year as number;

  // Débito fiscal = IVA generado en ventas (LibroVentaLine.ivaAmount) por mes.
  // findMany parametrizado + agregación en JS (evita el tipado estricto de
  // groupBy y sigue siendo 100% parametrizado, sin $queryRawUnsafe).
  const debitLines = await prisma.libroVentaLine.findMany({
    where: { organizationId, periodYear: year, status: "ACTIVE" },
    select: { periodMonth: true, ivaAmount: true },
    take: rowCap,
    orderBy: { periodMonth: "asc" },
  });

  // Crédito fiscal = IVA soportado en compras (LibroCompraLine.ivaAmount) por mes.
  const creditLines = await prisma.libroCompraLine.findMany({
    where: { organizationId, periodYear: year, status: "ACTIVE" },
    select: { periodMonth: true, ivaAmount: true },
    take: rowCap,
    orderBy: { periodMonth: "asc" },
  });

  const debitMap = new Map<number, number>();
  for (const l of debitLines) {
    debitMap.set(
      l.periodMonth,
      (debitMap.get(l.periodMonth) ?? 0) + toNumber(l.ivaAmount),
    );
  }
  const creditMap = new Map<number, number>();
  for (const l of creditLines) {
    creditMap.set(
      l.periodMonth,
      (creditMap.get(l.periodMonth) ?? 0) + toNumber(l.ivaAmount),
    );
  }

  const months = new Set<number>([...debitMap.keys(), ...creditMap.keys()]);
  const rows: VatRow[] = [];
  for (const month of months) {
    const debit = debitMap.get(month) ?? 0;
    const credit = creditMap.get(month) ?? 0;
    rows.push({ month, debit, credit, net: debit - credit });
  }
  rows.sort((a, b) => a.month - b.month);
  return rows.slice(0, rowCap);
}

type WithholdingRow = {
  supplierId: number | null;
  supplierName: string;
  totalRetained: number;
  count: number;
};

async function runWithholdingSummaryBySupplier(
  ctx: FiscalQueryRunnerContext,
): Promise<WithholdingRow[]> {
  const { prisma, organizationId, params, rowCap } = ctx;
  const from = new Date(params.fromDate as string);
  const to = new Date(params.toDate as string);

  // Expense con retención > 0 en el rango, con proveedor incluido para nombre.
  // Filtramos por `date` (fecha del gasto) y deletedAt null (compliance fiscal).
  const expenses = await prisma.expense.findMany({
    where: {
      organizationId,
      date: { gte: from, lte: to },
      deletedAt: null,
      withholdingIvaAmount: { gt: 0 },
    },
    select: {
      supplierId: true,
      withholdingIvaAmount: true,
      supplier: { select: { id: true, name: true } },
    },
    take: rowCap,
    orderBy: { date: "asc" },
  });

  const bySupplier = new Map<
    string,
    {
      supplierId: number | null;
      supplierName: string;
      total: number;
      count: number;
    }
  >();
  for (const e of expenses) {
    const key =
      e.supplierId != null
        ? `id:${e.supplierId}`
        : `name:${e.supplier?.name ?? "SIN PROVEEDOR"}`;
    const entry = bySupplier.get(key) ?? {
      supplierId: e.supplierId ?? null,
      supplierName: e.supplier?.name ?? "SIN PROVEEDOR",
      total: 0,
      count: 0,
    };
    entry.total += toNumber(e.withholdingIvaAmount);
    entry.count += 1;
    bySupplier.set(key, entry);
  }

  const rows: WithholdingRow[] = [...bySupplier.values()].map((v) => ({
    supplierId: v.supplierId,
    supplierName: v.supplierName,
    totalRetained: v.total,
    count: v.count,
  }));
  rows.sort((a, b) => b.totalRetained - a.totalRetained);
  return rows.slice(0, rowCap);
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  // Prisma Decimal llega como Decimal.js object o string; convertir de forma segura.
  const n = Number(value as { toString: () => string } | string);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Allow-list de queries fiscales. Añadir nuevas entradas aquí (código versionado).
 */
export const FISCAL_CATALOG: readonly FiscalCatalogEntry[] = [
  {
    id: "vat_debts_by_month",
    description:
      "Débitos y créditos de IVA por mes para un año dado (libro de venta vs compra).",
    roles: [Role.ADMIN, Role.FISCAL],
    paramsClass: VatDebtsByMonthParamsDto as unknown as new () => Record<
      string,
      unknown
    >,
    run: runVatDebtsByMonth,
  },
  {
    id: "withholding_summary_by_supplier",
    description:
      "Resumen de retenciones IVA por proveedor en un rango de fechas (basado en gastos).",
    roles: [Role.ADMIN, Role.FISCAL],
    paramsClass:
      WithholdingSummaryBySupplierParamsDto as unknown as new () => Record<
        string,
        unknown
      >,
    run: runWithholdingSummaryBySupplier,
  },
];

export function getFiscalCatalogEntry(
  id: string,
): FiscalCatalogEntry | undefined {
  return FISCAL_CATALOG.find((e) => e.id === id);
}

/**
 * Extrae el schema de params de una clase DTO leyendo la metadata de
 * class-validator (decoradores @IsInt, @IsString, @IsDateString, @IsOptional,
 * etc.). No instancia valores; solo lee metadata registrada por los
 * decoradores al cargar el módulo.
 */
function extractParamsSchema(
  paramsClass: new () => Record<string, unknown>,
): CatalogEntryParamsField[] {
  const storage = getMetadataStorage();
  const metadatas = storage.getTargetValidationMetadatas(
    paramsClass,
    "",
    false,
    false,
  );

  const byProperty = new Map<
    string,
    { names: Set<string>; optional: boolean }
  >();
  for (const m of metadatas) {
    const prop = m.propertyName;
    const entry = byProperty.get(prop) ?? {
      names: new Set<string>(),
      optional: false,
    };
    if (m.type === ValidationTypes.CONDITIONAL_VALIDATION) {
      // @IsOptional() registra una validación condicional.
      entry.optional = true;
    } else if (
      m.type === ValidationTypes.CUSTOM_VALIDATION &&
      typeof m.name === "string"
    ) {
      entry.names.add(m.name);
    }
    byProperty.set(prop, entry);
  }

  const fields: CatalogEntryParamsField[] = [];
  for (const [name, info] of byProperty) {
    fields.push({
      name,
      type: mapValidatorType(info.names),
      required: !info.optional,
    });
  }
  // Orden determinista para que el hash sea estable.
  fields.sort((a, b) => a.name.localeCompare(b.name));
  return fields;
}

function mapValidatorType(names: Set<string>): CatalogEntryParamsField["type"] {
  if (names.has("isInt")) return "integer";
  if (names.has("isNumber")) return "number";
  if (names.has("isDateString") || names.has("isDate")) return "date";
  if (names.has("isString")) return "string";
  if (names.has("isBoolean")) return "boolean";
  return "unknown";
}

/**
 * Construye la lista saneada de entradas del catálogo (sin `run`, sin
 * `paramsClass`, sin SQL, sin tablas). Solo metadata de contrato.
 */
export function getCatalogEntriesResponse(): CatalogEntryResponse[] {
  return FISCAL_CATALOG.map((e) => ({
    id: e.id,
    description: e.description,
    paramsSchema: extractParamsSchema(e.paramsClass),
    roles: [...e.roles],
  }));
}

/**
 * Versión del catálogo (C5): SHA-256 de la serialización determinista del
 * contrato saneado (id + description + roles + paramsSchema).
 *
 * Cambia cuando el contrato público cambia (no cuando la implementación
 * interna del runner cambia). Esto es lo que el agente debe comparar para
 * detectar drift.
 */
export function getCatalogVersion(): string {
  const payload = getCatalogEntriesResponse();
  const serialized = JSON.stringify(payload);
  return createHash("sha256").update(serialized).digest("hex");
}
