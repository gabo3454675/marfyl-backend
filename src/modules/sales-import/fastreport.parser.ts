export interface ParsedSaleLine {
  productCode: string;
  description: string;
  quantity: number;
  lineTotal: number;
}

export interface ParsedSaleInvoice {
  legacyKey: string;
  documentType: string;
  documentNumber: string;
  saleDate: string; // DD/MM/YYYY
  customer: string;
  headerTotalNet?: number;
  lines: ParsedSaleLine[];
  sourceFile: string;
}

const DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;
const DOC_RE = /^\d{6,10}$/;

function decodeXml(value: string): string {
  return value
    .replace(/&#10;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function parseNum(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = String(raw).split(/[\r\n]/)[0].replace(/\s+/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseSpreadsheetRows(xml: string): Map<number, string>[] {
  const rows: Map<number, string>[] = [];
  const rowRegex = /<Row[^>]*>([\s\S]*?)<\/Row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const cells = new Map<number, string>();
    let nextAuto = 1;
    const cellRegex = /<Cell([^>]*)>([\s\S]*?)<\/Cell>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const indexMatch = attrs.match(/ss:Index="(\d+)"/);
      const idx = indexMatch ? Number(indexMatch[1]) : nextAuto;
      const dataMatch = body.match(/<Data[^>]*>([\s\S]*?)<\/Data>/);
      const value = decodeXml(dataMatch?.[1] ?? "");
      if (value) cells.set(idx, value);
      nextAuto = idx + 1;
    }
    if (cells.size > 0) rows.push(cells);
  }
  return rows;
}

function get(cells: Map<number, string>, index: number): string {
  return (cells.get(index) ?? "").trim();
}

function getAny(cells: Map<number, string>, indices: number[]): string {
  for (const i of indices) {
    const v = get(cells, i);
    if (v) return v;
  }
  return "";
}

function parseNumAny(cells: Map<number, string>, indices: number[]): number | null {
  for (const i of indices) {
    const n = parseNum(get(cells, i));
    if (n != null) return n;
  }
  return null;
}

function isSkuCode(value: string): boolean {
  const normalized = value.replace(/\s/g, "");
  return /^\d{5,14}$/.test(normalized);
}

function buildLegacyKey(type: string, doc: string): string {
  return `${type}-${doc}`;
}

function parseSaleDate(ddmmyyyy: string): Date {
  const [dd, mm, yyyy] = ddmmyyyy.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd, 12, 0, 0);
}

export { parseSaleDate };

export function detectReportKind(xml: string): "ventas" | "productos" {
  if (/REPORTE\s+DE\s+PRODUCTOS\s+VENDIDOS/i.test(xml)) return "productos";
  return "ventas";
}

export function parseVentasReport(xml: string, sourceFile: string): ParsedSaleInvoice[] {
  const rows = parseSpreadsheetRows(xml);
  const invoices: ParsedSaleInvoice[] = [];
  let current: ParsedSaleInvoice | null = null;
  let inLineSection = false;

  for (const cells of rows) {
    const c1 = get(cells, 1);
    const c7 = getAny(cells, [7]);
    const c12 = getAny(cells, [12]);
    const customer = getAny(cells, [24, 26]);

    if (DATE_RE.test(c1) && c7 === "FAC" && DOC_RE.test(c12)) {
      current = {
        legacyKey: buildLegacyKey("FAC", c12),
        documentType: "FAC",
        documentNumber: c12,
        saleDate: c1,
        customer: customer || "CLIENTE NATURAL CONTADO",
        headerTotalNet: parseNumAny(cells, [80, 91]) ?? undefined,
        lines: [],
        sourceFile,
      };
      invoices.push(current);
      inLineSection = false;
      continue;
    }

    const codigoHeader = getAny(cells, [1, 3, 4]) === "Codigo";
    const descHeader = getAny(cells, [14, 16, 17, 18]) === "Descripcion";
    if (codigoHeader && descHeader) {
      inLineSection = true;
      continue;
    }

    if (!inLineSection || !current) continue;

    const code = getAny(cells, [1, 4]);
    const desc = getAny(cells, [14, 16, 18]);
    const qty = parseNumAny(cells, [41, 43]);
    const lineTotal = parseNumAny(cells, [69, 68, 67]);
    if (!code || qty == null || qty <= 0) continue;
    if (!isSkuCode(code)) continue;

    current.lines.push({
      productCode: code.replace(/\s/g, ""),
      description: desc,
      quantity: Math.round(qty),
      lineTotal: lineTotal ?? 0,
    });
  }

  return invoices.filter((inv) => inv.lines.length > 0);
}

export function parseProductosReport(xml: string, sourceFile: string): ParsedSaleInvoice[] {
  const rows = parseSpreadsheetRows(xml);
  const invoiceMap = new Map<string, ParsedSaleInvoice>();
  let currentProductCode = "";
  let currentProductName = "";
  let inDetailSection = false;
  let pendingLine: {
    legacyKey: string;
    documentType: string;
    documentNumber: string;
    saleDate: string;
    customer: string;
    quantity: number;
  } | null = null;

  const flushPending = (lineTotal: number) => {
    if (!pendingLine || !currentProductCode || lineTotal <= 0) return;
    let inv = invoiceMap.get(pendingLine.legacyKey);
    if (!inv) {
      inv = {
        legacyKey: pendingLine.legacyKey,
        documentType: pendingLine.documentType,
        documentNumber: pendingLine.documentNumber,
        saleDate: pendingLine.saleDate,
        customer: pendingLine.customer,
        lines: [],
        sourceFile,
      };
      invoiceMap.set(pendingLine.legacyKey, inv);
    }
    inv.lines.push({
      productCode: currentProductCode,
      description: currentProductName,
      quantity: Math.round(pendingLine.quantity),
      lineTotal,
    });
    pendingLine = null;
  };

  for (const cells of rows) {
    if (getAny(cells, [1, 2, 4]) === "Codigo" && getAny(cells, [9, 11, 18]) === "Descripcion") {
      inDetailSection = false;
      pendingLine = null;
      continue;
    }

    const c1 = get(cells, 1);
    if (
      c1 &&
      !DATE_RE.test(c1) &&
      c1 !== "Codigo" &&
      c1 !== "Documento" &&
      !DOC_RE.test(c1) &&
      !isSkuCode(c1) &&
      c1.length > 2
    ) {
      currentProductName = c1.trim();
    }
    if (c1 && isSkuCode(c1)) {
      currentProductCode = c1.replace(/\s/g, "");
    }

    if (get(cells, 1) === "Documento" && getAny(cells, [8, 12]) === "Tipo") {
      inDetailSection = true;
      pendingLine = null;
      continue;
    }

    if (!inDetailSection || !currentProductCode) continue;

    const doc = get(cells, 1).trim();
    const fecha = getAny(cells, [6, 17, 19]);
    if (DOC_RE.test(doc) && DATE_RE.test(fecha)) {
      const tipo = getAny(cells, [12, 8]) || "FAC";
      const cliente = getAny(cells, [20, 21]);
      const qty = parseNumAny(cells, [30, 35, 38]);
      const inlineTotal = parseNumAny(cells, [55, 67, 68, 69, 60]);
      if (qty == null || qty <= 0) continue;

      const legacyKey = buildLegacyKey(tipo || "FAC", doc);
      if (inlineTotal != null && inlineTotal > 0) {
        pendingLine = {
          legacyKey,
          documentType: tipo || "FAC",
          documentNumber: doc,
          saleDate: fecha,
          customer: cliente || "CLIENTE NATURAL CONTADO",
          quantity: qty,
        };
        flushPending(inlineTotal);
        continue;
      }

      pendingLine = {
        legacyKey,
        documentType: tipo || "FAC",
        documentNumber: doc,
        saleDate: fecha,
        customer: cliente || "CLIENTE NATURAL CONTADO",
        quantity: qty,
      };
      continue;
    }

    if (pendingLine) {
      const lineTotal = parseNumAny(cells, [55, 67, 68, 69, 60, 36]);
      if (lineTotal != null && lineTotal > 0) {
        flushPending(lineTotal);
      }
    }
  }

  return [...invoiceMap.values()].filter((inv) => inv.lines.length > 0);
}

export function parseFastReportSalesFile(
  xml: string,
  sourceFile: string,
): ParsedSaleInvoice[] {
  const kind = detectReportKind(xml);
  return kind === "productos"
    ? parseProductosReport(xml, sourceFile)
    : parseVentasReport(xml, sourceFile);
}

export function mergeInvoicesByLegacyKey(
  batches: ParsedSaleInvoice[],
): ParsedSaleInvoice[] {
  const map = new Map<string, ParsedSaleInvoice>();
  for (const inv of batches) {
    const existing = map.get(inv.legacyKey);
    if (!existing) {
      map.set(inv.legacyKey, { ...inv, lines: [...inv.lines] });
      continue;
    }
    existing.lines.push(...inv.lines);
  }
  return [...map.values()];
}
