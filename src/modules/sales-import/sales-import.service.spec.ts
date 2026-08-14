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
      expect(workbook.worksheets[0].name).toBe("DATOS");
      expect(workbook.worksheets[1].name).toBe("Productos");
      expect(workbook.worksheets[2].name).toBe("Instrucciones");
    });

    it("should have correct headers on DATOS sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];

      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      for (let c = 1; c <= 8; c++) {
        headers.push(String(headerRow.getCell(c).value ?? ""));
      }

      expect(headers).toEqual([
        "FECHA",
        "DOCUMENTO",
        "SKU",
        "NOMBRE DEL PRODUCTO",
        "CANTIDAD",
        "TOTAL LINEA USD",
        "METODO PAGO",
        "CLIENTE",
      ]);
    });

    it("should have an example row on DATOS sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];

      expect(ws.rowCount).toBe(2);
      const exampleRow = ws.getRow(2);
      expect(String(exampleRow.getCell(1).value)).toBe("11/08/2026");
      expect(String(exampleRow.getCell(3).value)).toBe("ABC-001");
      expect(Number(exampleRow.getCell(5).value)).toBe(2);
    });

    it("should have correct headers on Productos sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[1]; // "Productos"

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

    it("should have frozen header row on DATOS sheet", async () => {
      const buffer = await service.generateSalesTemplateBuffer(1);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];

      expect(ws.views).toMatchObject([
        expect.objectContaining({ state: "frozen", ySplit: 1 }),
      ]);
    });
  });
});
