import * as XLSX from "xlsx";
import type { OutflowMovementType } from "../inventory/dto/create-movement.dto";
import type { ConsumptionReason } from "@prisma/client";

export interface ParsedAutoconsumoLine {
  rowNum: number;
  dateLabel: string;
  sku: string;
  productName: string;
  quantity: number;
  type: OutflowMovementType;
  consumptionReason?: ConsumptionReason;
  reason: string;
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

function parseDateLabel(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && value > 40000) {
    const utc = (value - 25569) * 86400 * 1000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return raw;
}

const TYPES = new Set([
  "AUTOCONSUMO",
  "MERMA_VENCIDO",
  "MERMA_DANADO",
  "USO_TALLER",
]);

const REASONS = new Set(["MERMA", "MUESTRAS", "USO_OPERATIVO"]);

export function parseAutoconsumoExcel(buffer: Buffer): ParsedAutoconsumoLine[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet =
    workbook.Sheets["DATOS"] ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("El Excel no tiene hojas");

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
    throw new Error("Falta fila de encabezados con SKU y CANTIDAD");
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
  const cSku = col("sku");
  const cNombre = col("nombre");
  const cCantidad = col("cantidad");
  const cTipo = col("tipo");
  const cMotivo = col("motivo");
  const cRazon = col("razon", "reason", "nota");

  if (cSku < 0 || cCantidad < 0 || cTipo < 0) {
    throw new Error("Columnas obligatorias: SKU, CANTIDAD, TIPO");
  }

  const out: ParsedAutoconsumoLine[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const sku = String(row[cSku] ?? "").trim();
    const qty = parseNum(row[cCantidad]);
    const typeRaw = String(row[cTipo] ?? "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
    if (!sku || qty == null || qty <= 0) continue;
    if (!TYPES.has(typeRaw)) {
      throw new Error(
        `Fila ${r + 1}: TIPO inválido "${row[cTipo]}". Use AUTOCONSUMO, MERMA_VENCIDO, MERMA_DANADO o USO_TALLER`,
      );
    }
    const motivoRaw =
      cMotivo >= 0
        ? String(row[cMotivo] ?? "")
            .trim()
            .toUpperCase()
            .replace(/\s+/g, "_")
        : "";
    const consumptionReason =
      motivoRaw && REASONS.has(motivoRaw)
        ? (motivoRaw as ConsumptionReason)
        : undefined;

    out.push({
      rowNum: r + 1,
      dateLabel: cFecha >= 0 ? parseDateLabel(row[cFecha]) : "",
      sku,
      productName: cNombre >= 0 ? String(row[cNombre] ?? "").trim() : "",
      quantity: Math.round(qty),
      type: typeRaw as OutflowMovementType,
      consumptionReason,
      reason:
        (cRazon >= 0 ? String(row[cRazon] ?? "").trim() : "") ||
        `Import Excel fila ${r + 1}`,
    });
  }
  return out;
}
