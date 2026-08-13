import { SalesImportService } from "./sales-import.service";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require("exceljs");

// Mock mínimo de PrismaService
const mockPrisma = {
  product: { findMany: jest.fn().mockResolvedValue([]) },
  invoice: { findMany: jest.fn().mockResolvedValue([]) },
  salesImportPreviewBatch: {
    create: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  organization: { findUnique: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};

const mockInvoiceSequence = { allocateNext: jest.fn() };

describe("SalesImportService - Template", () => {
  let service: SalesImportService;

  beforeEach(() => {
    service = new SalesImportService(
      mockPrisma as any,
      mockInvoiceSequence as any,
    );
  });

  describe("generateSalesTemplateBuffer", () => {
    it("should return a Buffer", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("should generate a valid Excel file with 3 worksheets", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      expect(workbook.worksheets.length).toBe(3);
      expect(workbook.worksheets[0].name).toBe("Productos");
      expect(workbook.worksheets[1].name).toBe("Ventas");
      expect(workbook.worksheets[2].name).toBe("Instrucciones");
    });

    it("should have correct headers on Ventas sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[1]; // "Ventas"

      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      for (let c = 1; c <= 6; c++) {
        headers.push(String(headerRow.getCell(c).value ?? ""));
      }

      expect(headers).toEqual([
        "FECHA",
        "CODIGO_PRODUCTO",
        "CANTIDAD",
        "PRECIO_UNITARIO",
        "CLIENTE",
        "OBSERVACION",
      ]);
    });

    it("should have an example row on Ventas sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[1]; // "Ventas"

      // Row 1 = headers, Row 2 = example
      expect(ws.rowCount).toBe(2);
      const exampleRow = ws.getRow(2);
      expect(String(exampleRow.getCell(1).value)).toBe("2025-01-15");
      expect(String(exampleRow.getCell(2).value)).toBe("ABC-001");
      expect(Number(exampleRow.getCell(3).value)).toBe(3);
    });

    it("should have correct headers on Productos sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0]; // "Productos"

      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      for (let c = 1; c <= 5; c++) {
        headers.push(String(headerRow.getCell(c).value ?? ""));
      }

      expect(headers).toEqual([
        "SKU",
        "NOMBRE",
        "PRECIO_VENTA",
        "STOCK",
        "CODIGO_BARRAS",
      ]);
    });

    it("should have frozen header row on Ventas sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[1]; // "Ventas"

      expect(ws.views).toMatchObject([
        expect.objectContaining({ state: "frozen", ySplit: 1 }),
      ]);
    });
  });
});
