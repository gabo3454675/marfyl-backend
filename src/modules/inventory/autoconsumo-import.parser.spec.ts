import * as ExcelJS from "exceljs";
import { parseAutoconsumoExcel } from "./autoconsumo-import.parser";

async function buildAutoconsumoTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("DATOS");
  ws.addRow(["FECHA", "SKU", "NOMBRE", "CANTIDAD", "TIPO", "MOTIVO", "RAZON"]);
  ws.addRow([
    "13/08/2026",
    "SKU-9",
    "Agua",
    1,
    "AUTOCONSUMO",
    "USO_OPERATIVO",
    "prueba",
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("autoconsumo-import.parser", () => {
  it("parsea una línea AUTOCONSUMO de la plantilla MARFYL", async () => {
    const lines = parseAutoconsumoExcel(await buildAutoconsumoTemplate());
    expect(lines).toHaveLength(1);
    expect(lines[0].sku).toBe("SKU-9");
    expect(lines[0].quantity).toBe(1);
    expect(lines[0].type).toBe("AUTOCONSUMO");
  });
});
