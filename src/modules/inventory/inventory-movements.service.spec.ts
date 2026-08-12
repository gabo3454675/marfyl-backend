import { InventoryMovementsService } from "./inventory-movements.service";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require("exceljs");

// Mock de PrismaService y dependencias
const mockPrisma = {
  product: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  inventoryMovement: { create: jest.fn(), findMany: jest.fn() },
  productVariant: { findUnique: jest.fn() },
  expenseCategory: { findFirst: jest.fn(), create: jest.fn() },
  expense: { create: jest.fn() },
  $transaction: jest.fn(),
};

const mockActivityLog = { log: jest.fn() };
const mockPushNotification = { notifyStockBajo: jest.fn() };

describe("InventoryMovementsService - Template", () => {
  let service: InventoryMovementsService;

  beforeEach(() => {
    service = new InventoryMovementsService(
      mockPrisma as any,
      mockActivityLog as any,
      mockPushNotification as any,
    );
  });

  describe("generateConsumptionTemplateBuffer", () => {
    it("should return a Buffer", async () => {
      const buffer = await service.generateConsumptionTemplateBuffer();
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it("should generate a valid Excel file", async () => {
      const buffer = await service.generateConsumptionTemplateBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);

      expect(workbook.worksheets.length).toBe(1);
      const ws = workbook.worksheets[0];
      expect(ws.name).toBe("Consumo");
    });

    it("should have correct headers", async () => {
      const buffer = await service.generateConsumptionTemplateBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];

      const headerRow = ws.getRow(1);
      const headers: string[] = [];
      for (let c = 1; c <= 6; c++) {
        headers.push(String(headerRow.getCell(c).value ?? ""));
      }

      expect(headers).toEqual([
        "CODIGO_PRODUCTO",
        "CANTIDAD",
        "MOTIVO",
        "RESPONSABLE",
        "FECHA",
        "OBSERVACION",
      ]);
    });

    it("should have an example row", async () => {
      const buffer = await service.generateConsumptionTemplateBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];

      // Row 1 = headers, Row 2 = example. dataValidation extends rowCount
      const exampleRow = ws.getRow(2);
      expect(String(exampleRow.getCell(1).value)).toBe("ABC-001");
      expect(Number(exampleRow.getCell(2).value)).toBe(5);
      expect(String(exampleRow.getCell(3).value)).toBe("AUTOCONSUMO");
    });

    it("should have frozen header row", async () => {
      const buffer = await service.generateConsumptionTemplateBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];

      expect(ws.views).toMatchObject([
        expect.objectContaining({ state: "frozen", ySplit: 1 }),
      ]);
    });
  });
});
