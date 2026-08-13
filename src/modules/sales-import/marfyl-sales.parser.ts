import * as XLSX from "xlsx";
import type { ParsedSaleInvoice, ParsedSaleLine } from "./fastreport.parser";

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function excelSerialToDmY(serial: number): string {
  const utc = (serial - 25569) * 86400 * 1000;
  const d = new Date(utc);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function parseDateCell(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 40000) {
    return excelSerialToDmY(value);
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${dd.padStart(2, "0")}/${mm.padStart(2, "0")}/${yyyy}`;
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return null;
}

export function isMarfylSalesWorkbook(buffer: Buffer): boolean {
  // FastReport legacy is SpreadsheetML XML
  const head = buffer.subarray(0, 200).toString("utf8");
  if (head.includes("<?xml") || head.includes("ss:Workbook") || head.includes("<Workbook")) {
    return false;
  }
  try {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet =
      wb.Sheets["DATOS"] ?? wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return false;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
    });
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const headers = (rows[i] ?? []).map(normalizeHeader);
      const hasFecha = headers.some((h) => h === "fecha" || h.includes("fecha"));
      const hasSku = headers.some((h) => h === "sku");
      const hasDoc = headers.some(
        (h) => h === "documento" || h.includes("documento") || h === "ticket",
      );
      const hasQty = headers.some((h) => h === "cantidad");
      const hasTotal = headers.some(
        (h) => h.includes("total") || h.includes("linea"),
      );
      if (hasFecha && hasSku && hasDoc && hasQty && hasTotal) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Plantilla MARFYL ventas manuales:
 * FECHA | DOCUMENTO | SKU | NOMBRE DEL PRODUCTO | CANTIDAD | TOTAL LINEA USD | METODO PAGO | CLIENTE
 */
export function parseMarfylSalesExcel(
  buffer: Buffer,
  sourceFile: string,
): ParsedSaleInvoice[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet =
    workbook.Sheets["DATOS"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("El Excel de ventas no tiene hojas");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = (rows[i] ?? []).map(normalizeHeader);
    if (headers.includes("sku") && headers.includes("cantidad")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      "Plantilla de ventas inválida: falta fila con SKU y CANTIDAD",
    );
  }

  const headers = (rows[headerIdx] ?? []).map(normalizeHeader);
  const col = (...names: string[]): number => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i] ?? "";
      if (names.some((n) => h === n || h.includes(n))) return i;
    }
    return -1;
  };

  const cFecha = col("fecha");
  const cDoc = col("documento", "ticket", "factura");
  const cSku = col("sku");
  const cNombre = col("nombre");
  const cCantidad = col("cantidad");
  const cTotal = col("total linea", "total", "monto");
  const cCliente = col("cliente");

  if (cFecha < 0 || cDoc < 0 || cSku < 0 || cCantidad < 0 || cTotal < 0) {
    throw new Error(
      "Columnas obligatorias: FECHA, DOCUMENTO, SKU, CANTIDAD, TOTAL LINEA USD",
    );
  }

  const groups = new Map<
    string,
    {
      saleDate: string;
      customer: string;
      lines: ParsedSaleLine[];
      headerTotal: number;
    }
  >();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const sku = String(row[cSku] ?? "").trim();
    const qty = parseNum(row[cCantidad]);
    const total = parseNum(row[cTotal]);
    const doc = String(row[cDoc] ?? "").trim();
    const fecha = parseDateCell(row[cFecha]);
    if (!sku || !doc || qty == null || qty <= 0 || total == null) continue;
    if (!fecha) {
      throw new Error(`Fila ${r + 1}: FECHA inválida (use DD/MM/AAAA)`);
    }

    const legacyKey = doc.toUpperCase().startsWith("MANUAL-")
      ? doc.toUpperCase()
      : `MANUAL-${doc}`;
    const customer =
      (cCliente >= 0 ? String(row[cCliente] ?? "").trim() : "") ||
      "CLIENTE NATURAL CONTADO";
    const description =
      (cNombre >= 0 ? String(row[cNombre] ?? "").trim() : "") || sku;

    const g = groups.get(legacyKey) ?? {
      saleDate: fecha,
      customer,
      lines: [],
      headerTotal: 0,
    };
    g.lines.push({
      productCode: sku,
      description,
      quantity: Math.round(qty),
      lineTotal: Number(total.toFixed(2)),
    });
    g.headerTotal = Number((g.headerTotal + total).toFixed(2));
    g.saleDate = fecha;
    if (customer) g.customer = customer;
    groups.set(legacyKey, g);
  }

  return [...groups.entries()].map(([legacyKey, g]) => ({
    legacyKey,
    documentType: "MANUAL",
    documentNumber: legacyKey.replace(/^MANUAL-/, ""),
    saleDate: g.saleDate,
    customer: g.customer,
    headerTotalNet: g.headerTotal,
    lines: g.lines,
    sourceFile,
  }));
}
