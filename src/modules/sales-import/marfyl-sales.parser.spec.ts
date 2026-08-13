import * as ExcelJS from "exceljs";
import {
  isMarfylSalesWorkbook,
  parseMarfylSalesExcel,
} from "./marfyl-sales.parser";

async function buildSalesTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DATOS");
  ws.addRow([
    "FECHA",
    "DOCUMENTO",
    "SKU",
    "NOMBRE DEL PRODUCTO",
    "CANTIDAD",
    "TOTAL LINEA USD",
    "METODO PAGO",
    "CLIENTE",
  ]);
  ws.addRow([
    "13/08/2026",
    "T-1",
    "SKU-1",
    "Cerveza",
    2,
    10,
    "EFECTIVO",
    "Mostrador",
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("marfyl-sales.parser", () => {
  it("reconoce la plantilla MARFYL y parsea una línea", async () => {
    const buffer = await buildSalesTemplate();
    expect(isMarfylSalesWorkbook(buffer)).toBe(true);
    const invoices = parseMarfylSalesExcel(buffer, "ventas.xlsx");
    expect(invoices).toHaveLength(1);
    expect(invoices[0].lines[0].productCode).toBe("SKU-1");
    expect(invoices[0].lines[0].quantity).toBe(2);
  });

  it("no trata XML FastReport como plantilla MARFYL", () => {
    const xml = Buffer.from('<?xml version="1.0"?><Workbook></Workbook>');
    expect(isMarfylSalesWorkbook(xml)).toBe(false);
  });
});
