import * as XLSX from "xlsx";

export interface ParsedPurchaseLine {
  rowNum: number;
  sku: string;
  shortName: string;
  description: string;
  quantity: number;
  unitCostUsd: number;
  salePriceUsd: number;
  isExempt: boolean;
  status: string;
}

export interface ParsedPurchaseGroup {
  groupIndex: number;
  monthLabel: string;
  purchaseDate: string; // YYYY-MM-DD
  invoiceRef: string;
  supplierName: string;
  lines: ParsedPurchaseLine[];
}

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

function excelSerialToIso(serial: number): string {
  const utc = (serial - 25569) * 86400 * 1000;
  return new Date(utc).toISOString().slice(0, 10);
}

function parseDateCell(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 40000) {
    return excelSerialToIso(value);
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, dd, mm, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return null;
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = (rows[i] ?? []).map(normalizeHeader);
    if (headers.includes("sku") && headers.includes("cantidad")) return i;
  }
  return -1;
}

export function parseMonddyPurchasesExcel(buffer: Buffer): ParsedPurchaseGroup[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("El Excel no tiene hojas");

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
  });
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new Error(
      "No se encontró fila de encabezados con columnas SKU y CANTIDAD",
    );
  }

  const headers = (rows[headerIdx] ?? []).map(normalizeHeader);
  const col = (name: string, aliases: string[] = []): number => {
    const candidates = [name, ...aliases];
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i] ?? "";
      if (candidates.some((c) => h === c || h.includes(c))) return i;
    }
    return -1;
  };

  const cMes = col("mes");
  const cFecha = col("fecha");
  const cFactura = col("factura");
  const cProveedor = col("proveedor");
  const cStatus = col("status");
  const cCantidad = col("cantidad");
  const cSku = col("sku");
  const cNombre = col("nombre del producto", ["nombre"]);
  const cCosto = col("costo");
  const cVenta = col("precio venta", ["venta"]);
  const cDesc = col("descripcion", ["descripción"]);
  const cExento = col("exento");

  if (cSku < 0 || cCantidad < 0 || cCosto < 0) {
    throw new Error("Columnas obligatorias faltantes: SKU, CANTIDAD, COSTO");
  }

  const groups: ParsedPurchaseGroup[] = [];
  let ctx = {
    monthLabel: "",
    purchaseDate: "",
    invoiceRef: "",
    supplierName: "",
  };
  let currentGroup: ParsedPurchaseGroup | null = null;
  let groupIndex = 0;

  const startGroup = () => {
    groupIndex += 1;
    currentGroup = {
      groupIndex,
      monthLabel: ctx.monthLabel,
      purchaseDate: ctx.purchaseDate,
      invoiceRef: ctx.invoiceRef,
      supplierName: ctx.supplierName,
      lines: [],
    };
    groups.push(currentGroup);
  };

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const mes = cMes >= 0 ? String(row[cMes] ?? "").trim() : "";
    const fechaRaw = cFecha >= 0 ? row[cFecha] : "";
    const factura = cFactura >= 0 ? String(row[cFactura] ?? "").trim() : "";
    const proveedor = cProveedor >= 0 ? String(row[cProveedor] ?? "").trim() : "";
    const parsedDate = parseDateCell(fechaRaw);

    const hasHeader =
      mes !== "" || parsedDate != null || factura !== "" || proveedor !== "";

    if (hasHeader) {
      if (mes) ctx.monthLabel = mes;
      if (parsedDate) ctx.purchaseDate = parsedDate;
      if (factura) ctx.invoiceRef = factura;
      if (proveedor) ctx.supplierName = proveedor;
      startGroup();
    }

    const sku = String(row[cSku] ?? "").trim();
    const qty = parseNum(row[cCantidad]);
    const unitCost = parseNum(row[cCosto]);
    if (!sku || qty == null || qty <= 0 || unitCost == null) continue;

    if (!currentGroup) startGroup();

    const salePrice = parseNum(cVenta >= 0 ? row[cVenta] : null) ?? 0;
    const description =
      (cDesc >= 0 ? String(row[cDesc] ?? "").trim() : "") ||
      (cNombre >= 0 ? String(row[cNombre] ?? "").trim() : "") ||
      sku;
    const exentoRaw =
      cExento >= 0 ? String(row[cExento] ?? "").trim().toUpperCase() : "";

    currentGroup!.lines.push({
      rowNum: r + 1,
      sku,
      shortName: cNombre >= 0 ? String(row[cNombre] ?? "").trim() : "",
      description,
      quantity: Math.round(qty),
      unitCostUsd: Number(unitCost.toFixed(4)),
      salePriceUsd: Number(salePrice.toFixed(2)),
      isExempt: exentoRaw.includes("EXENTO"),
      status: cStatus >= 0 ? String(row[cStatus] ?? "").trim() : "",
    });
  }

  return groups.filter((g) => g.lines.length > 0);
}
