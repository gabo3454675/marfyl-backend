import { BadRequestException } from "@nestjs/common";

const SALE_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

/**
 * Parsea fecha de venta legacy DD/MM/YYYY (mediodía local).
 * Devuelve Invalid Date si el formato o el calendario no son válidos.
 */
export function parseSaleDate(ddmmyyyy: string): Date {
  const raw = String(ddmmyyyy ?? "").trim();
  if (!SALE_DATE_RE.test(raw)) {
    return new Date(NaN);
  }
  const [dd, mm, yyyy] = raw.split("/").map(Number);
  const parsed = new Date(yyyy, mm - 1, dd, 12, 0, 0);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== yyyy ||
    parsed.getMonth() !== mm - 1 ||
    parsed.getDate() !== dd
  ) {
    return new Date(NaN);
  }
  return parsed;
}

/**
 * Fecha de emisión para import legacy: saleDate obligatorio y válido.
 * No cae a `new Date()` — fail-closed.
 */
export function requireImportIssueDate(
  saleDate: string,
  legacyKey?: string,
): Date {
  const key = (legacyKey ?? "").trim() || "factura";
  const missingMsg = `${key} sin fecha de venta (saleDate)`;
  if (saleDate == null || String(saleDate).trim() === "") {
    throw new Error(missingMsg);
  }
  const parsed = parseSaleDate(String(saleDate));
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(missingMsg);
  }
  return parsed;
}

/**
 * Fecha de emisión operativa (POS): DTO si viene; si no, ahora.
 * Input inválido → BadRequest.
 */
export function resolveOperationalIssueDate(
  input?: string | Date | null,
): Date {
  if (input == null || (typeof input === "string" && input.trim() === "")) {
    return new Date();
  }
  const parsed = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException("issueDate no es una fecha válida");
  }
  return parsed;
}

/**
 * Guard fail-closed para `invoice.create` / `createMany`.
 * - Legacy (isLegacyImport / legacyImportKey / importSource) sin issueDate → throw
 * - Operativa sin issueDate → setea `new Date()`
 * Mutates `data` in place.
 */
export function applyInvoiceIssueDateGuard(
  data: Record<string, unknown>,
): void {
  const issueDate = data.issueDate;
  const missing = issueDate === null || issueDate === undefined;
  if (!missing) {
    if (issueDate instanceof Date && Number.isNaN(issueDate.getTime())) {
      throw new Error("invoice.create issueDate inválido");
    }
    return;
  }

  const isLegacy =
    data.isLegacyImport === true ||
    (typeof data.legacyImportKey === "string" &&
      data.legacyImportKey.length > 0) ||
    (typeof data.importSource === "string" && data.importSource.length > 0);

  if (isLegacy) {
    throw new Error(
      "invoice.create legacy requiere issueDate (fail-closed)",
    );
  }

  data.issueDate = new Date();
}
