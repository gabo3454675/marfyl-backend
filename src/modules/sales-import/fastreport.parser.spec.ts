import { readFileSync } from "fs";
import { join } from "path";
import {
  detectReportKind,
  parseProductosReport,
  parseFastReportSalesFile,
} from "./fastreport.parser";

describe("fastreport.parser productos report", () => {
  const samplePath = join(
    process.env.HOME || "/home/gabdev",
    "Descargas/FACTURAS/Reporte General  de Productos Vendidos_14_07_26.xls",
  );

  let xml: string;
  beforeAll(() => {
    try {
      xml = readFileSync(samplePath, "utf8");
    } catch {
      xml = "";
    }
  });

  it("detects productos report kind", () => {
    if (!xml) return;
    expect(detectReportKind(xml)).toBe("productos");
  });

  it("does not use document numbers as product SKUs", () => {
    if (!xml) return;
    const invoices = parseProductosReport(xml, "sample.xls");
    const codes = new Set(
      invoices.flatMap((i) => i.lines.map((l) => l.productCode)),
    );
    const docs = new Set(invoices.map((i) => i.documentNumber));
    const overlap = [...codes].filter((c) => docs.has(c));
    expect(overlap).toEqual([]);
    expect(codes.has("00000052")).toBe(true);
  });

  it("keeps quantity and line total for HELADO BARQUILLA", () => {
    if (!xml) return;
    const invoices = parseFastReportSalesFile(xml, "sample.xls");
    const barquilla = invoices
      .flatMap((i) => i.lines.map((l) => ({ doc: i.documentNumber, ...l })))
      .find((l) => l.doc === "00009840" && l.productCode === "00000052");
    expect(barquilla).toBeTruthy();
    expect(barquilla!.quantity).toBe(2);
    expect(barquilla!.lineTotal).toBeCloseTo(2.8, 2);
  });
});
