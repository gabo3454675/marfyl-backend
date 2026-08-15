import { SalesImportService } from "./sales-import.service";
import type { ParsedSaleInvoice } from "./fastreport.parser";
import { parseMarfylSalesExcel } from "./marfyl-sales.parser";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require("exceljs");

// Mockeamos los parsers para no depender de archivos reales (patrón del spec
// de purchases-import). El servicio elige parser según isMarfylSalesWorkbook;
// aquí fijamos true para que use parseMarfylSalesExcel. mergeInvoicesByLegacyKey
// conserva el comportamiento real de agrupar líneas por legacyKey.
jest.mock("./fastreport.parser", () => ({
  parseFastReportSalesFile: jest.fn(),
  mergeInvoicesByLegacyKey: jest.fn(
    (batches: { legacyKey: string; lines: unknown[] }[]) => {
      const map = new Map<string, { legacyKey: string; lines: unknown[] }>();
      for (const inv of batches) {
        const existing = map.get(inv.legacyKey);
        if (!existing) {
          map.set(inv.legacyKey, { ...inv, lines: [...inv.lines] });
        } else {
          existing.lines.push(...inv.lines);
        }
      }
      return [...map.values()];
    },
  ),
}));

jest.mock("./marfyl-sales.parser", () => ({
  isMarfylSalesWorkbook: jest.fn(() => true),
  parseMarfylSalesExcel: jest.fn(),
}));

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
  // getCompanyIdFromOrganization (helper real) usa organization + company
  company: { findFirst: jest.fn() },
  customer: { findFirst: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};

// --- Fixtures ---

type ProductFixture = {
  id: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  salePrice: number;
  stock: number;
  isExempt: boolean;
  isBundle: boolean;
  isService: boolean;
};

const makeProduct = (
  overrides: Partial<ProductFixture> = {},
): ProductFixture => ({
  id: 1,
  name: "Producto A",
  sku: "ABC-001",
  barcode: null,
  salePrice: 5,
  stock: 10,
  isExempt: false,
  isBundle: false,
  isService: false,
  ...overrides,
});

/**
 * Factura legacy con una sola línea. headerTotalNet = lineTotal * 1.16 (IVA
 * 16%, computeInvoiceTax real) para que totalsMatch sea true y la invoice
 * quede "ready" en el preview (producto gravado y no exento).
 */
const makeParsedInvoice = (
  lineOverrides: Partial<{
    productCode: string;
    description: string;
    quantity: number;
    lineTotal: number;
  }> = {},
  overrides: Partial<ParsedSaleInvoice> = {},
): ParsedSaleInvoice => {
  const line = {
    productCode: "ABC-001",
    description: "Producto A",
    quantity: 2,
    lineTotal: 10,
    ...lineOverrides,
  };
  return {
    legacyKey: "LEGACY-1",
    documentType: "MANUAL",
    documentNumber: "0001",
    saleDate: "11/08/2026",
    customer: "CLIENTE NATURAL CONTADO",
    headerTotalNet: Number((line.lineTotal * 1.16).toFixed(2)),
    lines: [line],
    sourceFile: "ventas.xlsx",
    ...overrides,
  };
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

describe("SalesImportService - Preview (proyección de stock)", () => {
  let service: SalesImportService;

  const previewParams = {
    organizationId: 7,
    files: [{ buffer: Buffer.from("workbook"), originalname: "ventas.xlsx" }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Ruta elegida: isMarfylSalesWorkbook → true → parseMarfylSalesExcel
    (parseMarfylSalesExcel as jest.Mock).mockReturnValue([makeParsedInvoice()]);
    mockPrisma.organization.findUnique.mockResolvedValue({ nombre: "Mi Org" });
    mockPrisma.product.findMany.mockResolvedValue([makeProduct()]);
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.salesImportPreviewBatch.create.mockResolvedValue({
      id: "preview-1",
    });
    mockPrisma.salesImportPreviewBatch.deleteMany.mockResolvedValue({
      count: 0,
    });
    service = new SalesImportService(
      mockPrisma as any,
      mockInvoiceSequence as any,
    );
  });

  it("1. producto encontrado: currentStock, stockDelta=-quantity, finalStock", async () => {
    mockPrisma.product.findMany.mockResolvedValue([makeProduct({ stock: 10 })]);

    const result = await service.previewFromBuffers(previewParams);

    expect(result.summary.ready).toBe(1);
    const line = result.invoices[0].lines[0];
    expect(line.productId).toBe(1);
    expect(line.matchBy).toBe("sku");
    // Proyección real (projectStock): salida "out" resta quantity
    expect(line.currentStock).toBe(10);
    expect(line.stockDelta).toBe(-2);
    expect(line.finalStock).toBe(8);
  });

  it.each([
    { isService: true, isBundle: false, label: "servicio" },
    { isService: false, isBundle: true, label: "combo" },
  ])(
    "2. producto $label: stockDelta=0 (no afecta stock)",
    async ({ isService, isBundle }) => {
      mockPrisma.product.findMany.mockResolvedValue([
        makeProduct({ stock: 10, isService, isBundle }),
      ]);

      const result = await service.previewFromBuffers(previewParams);

      const line = result.invoices[0].lines[0];
      expect(line.currentStock).toBe(10);
      expect(line.stockDelta).toBe(0);
      expect(line.finalStock).toBe(10);
    },
  );

  it("3. línea sin match: currentStock/delta/final null", async () => {
    // Catálogo vacío → SKU "ABC-001" no matchea ningún producto
    mockPrisma.product.findMany.mockResolvedValue([]);

    const result = await service.previewFromBuffers(previewParams);

    expect(result.summary.errors).toBe(1);
    const line = result.invoices[0].lines[0];
    expect(line.productId).toBeUndefined();
    expect(line.currentStock).toBeNull();
    expect(line.stockDelta).toBeNull();
    expect(line.finalStock).toBeNull();
  });
});

describe("SalesImportService - Confirm (stock)", () => {
  let service: SalesImportService;
  let tx: {
    invoice: { findFirst: jest.Mock; create: jest.Mock };
    tasaHistorica: { create: jest.Mock };
    product: { update: jest.Mock };
  };

  const previewParams = {
    organizationId: 7,
    files: [{ buffer: Buffer.from("workbook"), originalname: "ventas.xlsx" }],
  };
  const confirmParams = { organizationId: 7, userId: 1 };

  beforeEach(() => {
    jest.clearAllMocks();
    (parseMarfylSalesExcel as jest.Mock).mockReturnValue([makeParsedInvoice()]);
    mockPrisma.organization.findUnique.mockResolvedValue({ nombre: "Mi Org" });
    mockPrisma.company.findFirst.mockResolvedValue({ id: 100 });
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 30 });
    mockPrisma.product.findMany.mockResolvedValue([makeProduct()]);
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    mockPrisma.salesImportPreviewBatch.create.mockResolvedValue({
      id: "preview-1",
    });
    mockPrisma.salesImportPreviewBatch.deleteMany.mockResolvedValue({
      count: 0,
    });
    mockPrisma.salesImportPreviewBatch.delete.mockResolvedValue({
      id: "preview-1",
    });
    mockPrisma.salesImportPreviewBatch.findFirst.mockResolvedValue(null);
    mockInvoiceSequence.allocateNext.mockResolvedValue(5);

    // Stub de transacción: la lógica de stock se ejecuta sobre tx.product.update
    tx = {
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 500 }),
      },
      tasaHistorica: { create: jest.fn().mockResolvedValue({ id: 200 }) },
      product: { update: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    mockPrisma.$transaction = jest
      .fn()
      .mockImplementation(async (fn) => fn(tx));

    service = new SalesImportService(
      mockPrisma as any,
      mockInvoiceSequence as any,
    );
  });

  /** Genera un preview real "ready" y lo hace disponible para confirm. */
  const setupConfirmPreview = async (
    invoice: ParsedSaleInvoice = makeParsedInvoice(),
  ) => {
    const previewResult = await service.previewFromBuffers(previewParams);
    mockPrisma.salesImportPreviewBatch.findFirst.mockResolvedValue({
      id: previewResult.batchId,
      payload: {
        sources: [invoice],
        preview: previewResult.invoices,
      },
    });
    return previewResult;
  };

  it("4. confirm decrementa stock: data.stock.decrement === quantity", async () => {
    mockPrisma.product.findMany.mockResolvedValue([makeProduct({ stock: 10 })]);
    const previewResult = await setupConfirmPreview();

    const result = await service.confirm({
      ...confirmParams,
      batchId: previewResult.batchId,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ stock: { decrement: 2 } }),
      }),
    );
  });

  it("5. stock insuficiente sin skipStockValidation: rechaza sin decrementar", async () => {
    mockPrisma.product.findMany.mockResolvedValue([makeProduct({ stock: 2 })]);
    const invoice = makeParsedInvoice({ quantity: 5, lineTotal: 25 });
    (parseMarfylSalesExcel as jest.Mock).mockReturnValue([invoice]);
    const previewResult = await setupConfirmPreview(invoice);
    expect(previewResult.invoices[0].status).toBe("ready");

    const result = await service.confirm({
      ...confirmParams,
      batchId: previewResult.batchId,
    });

    // confirm captura el error por invoice → failed=1, sin tocar stock
    expect(result.imported).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toContain("Stock insuficiente");
    expect(tx.product.update).not.toHaveBeenCalled();
  });

  it("6. skipStockValidation=true: procede y decrementa", async () => {
    mockPrisma.product.findMany.mockResolvedValue([makeProduct({ stock: 2 })]);
    const invoice = makeParsedInvoice({ quantity: 5, lineTotal: 25 });
    (parseMarfylSalesExcel as jest.Mock).mockReturnValue([invoice]);
    const previewResult = await setupConfirmPreview(invoice);

    const result = await service.confirm({
      ...confirmParams,
      batchId: previewResult.batchId,
      skipStockValidation: true,
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toBe(0);
    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ stock: { decrement: 5 } }),
      }),
    );
  });

  it("7. idempotencia por legacyImportKey: no decrementa dos veces y preview marca already_imported", async () => {
    // (a) Preview con invoice ya existente por legacyImportKey
    mockPrisma.invoice.findMany.mockResolvedValue([
      { legacyImportKey: "LEGACY-1" },
    ]);
    const alreadyPreview = await service.previewFromBuffers(previewParams);
    expect(alreadyPreview.summary.alreadyImported).toBe(1);
    expect(alreadyPreview.invoices[0].status).toBe("already_imported");

    // (b) Primer confirm: la invoice NO existe → decrementa una vez
    mockPrisma.invoice.findMany.mockResolvedValue([]);
    let alreadyExists = false;
    (tx.invoice.findFirst as jest.Mock).mockImplementation(async () =>
      alreadyExists ? { id: 500 } : null,
    );
    const previewResult = await setupConfirmPreview();

    const first = await service.confirm({
      ...confirmParams,
      batchId: previewResult.batchId,
    });
    expect(first.imported).toBe(1);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.invoice.create).toHaveBeenCalledTimes(1);

    // (c) Re-confirm del mismo batch: la invoice ya existe por legacyKey →
    // early return dentro de importSingleInvoice, sin decrementar de nuevo
    alreadyExists = true;
    const second = await service.confirm({
      ...confirmParams,
      batchId: previewResult.batchId,
    });
    expect(second.imported).toBe(1);
    expect(second.invoices[0].invoiceId).toBe(500);
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.invoice.create).toHaveBeenCalledTimes(1);
  });
});
