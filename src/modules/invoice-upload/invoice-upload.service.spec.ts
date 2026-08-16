// Mockear módulos con dependencias pesadas ANTES de importar el servicio.
// La cadena: receipt-scan.service → receipt-pdf-pages → pdfjs-dist causa
// "Cannot use 'import.meta' outside a module" en Jest/CommonJS.
jest.mock("@/modules/expenses/receipt-scan.service", () => ({
  ReceiptScanService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock("exceljs", () => ({ Workbook: jest.fn() }));
jest.mock("pdf-parse", () => jest.fn().mockResolvedValue({ text: "" }));

import { InvoiceUploadService } from "./invoice-upload.service";

// --- Mocks planos ---

const mockPrisma = {
  product: {
    findFirst: jest.fn(),
  },
  expenseCategory: {
    findFirst: jest.fn(),
  },
  organization: {
    findUnique: jest.fn(),
  },
  company: {
    findFirst: jest.fn(),
  },
  expense: {
    create: jest.fn(),
  },
  inventoryMovement: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockActivityLog = {
  log: jest.fn().mockResolvedValue(undefined),
};

const mockReceiptScan = {} as any;

// --- Helpers de fixture ---

function makeProduct(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: "Producto Test",
    isBundle: false,
    isService: false,
    isExempt: false,
    costPrice: 100,
    ...overrides,
  };
}

// --- Test suite ---

describe("InvoiceUploadService – desglose fiscal en confirm()", () => {
  let service: InvoiceUploadService;
  let tx: {
    expense: { create: jest.Mock };
    inventoryMovement: { create: jest.Mock };
    product: {
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    expensePayment: { create: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // getCompanyIdFromOrganization → companyId = 100
    mockPrisma.organization.findUnique.mockResolvedValue({ nombre: "Mi Org" });
    mockPrisma.company.findFirst.mockResolvedValue({ id: 100 });

    // Categoría de inventario
    mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 10 });

    // tx stub por defecto
    tx = {
      expense: { create: jest.fn().mockResolvedValue({ id: 900 }) },
      inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 901 }) },
      product: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 1 }),
      },
      expensePayment: { create: jest.fn().mockResolvedValue({ id: 902 }) },
    };
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));

    service = new InvoiceUploadService(
      mockPrisma as any,
      mockActivityLog as any,
      mockReceiptScan,
    );
  });

  /**
   * Helper que configura los mocks de producto y ejecuta confirm()
   * con un único producto gravado o exento.
   */
  async function runConfirm(params: {
    quantity: number;
    unitCostUsd: number;
    isExempt: boolean;
  }) {
    const product = makeProduct({ isExempt: params.isExempt, costPrice: params.unitCostUsd });

    mockPrisma.product.findFirst.mockResolvedValue(product);

    return service.confirm({
      organizationId: 1,
      userId: 1,
      dto: {
        lines: [
          {
            productId: 1,
            quantity: params.quantity,
            unitCostUsd: params.unitCostUsd,
          },
        ],
      },
    } as any);
  }

  it("gravado: baseGeneral=86.21, ivaAmount=13.79, baseExempt=0", async () => {
    // monto bruto = 1 × 100 = 100
    // base = round2(100 / 1.16) = 86.21
    // iva  = round2(100 − 86.21) = 13.79
    await runConfirm({ quantity: 1, unitCostUsd: 100, isExempt: false });

    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    const data = tx.expense.create.mock.calls[0][0].data;

    expect(data.amount).toBe(100);
    expect(data.baseGeneral).toBe(86.21);
    expect(data.ivaAmount).toBe(13.79);
    expect(data.baseExempt).toBe(0);

    // Identidad: baseGeneral + ivaAmount === amount
    expect(data.baseGeneral + data.ivaAmount).toBe(100);
  });

  it("exento: baseExempt=100, baseGeneral=0, ivaAmount=0", async () => {
    // monto bruto = 1 × 100 = 100
    // Todo va a baseExempt, sin desglose de IVA.
    await runConfirm({ quantity: 1, unitCostUsd: 100, isExempt: true });

    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    const data = tx.expense.create.mock.calls[0][0].data;

    expect(data.amount).toBe(100);
    expect(data.baseExempt).toBe(100);
    expect(data.baseGeneral).toBe(0);
    expect(data.ivaAmount).toBe(0);
  });

  it("redondeo: monto 4.06 → baseGeneral=3.50, ivaAmount=0.56", async () => {
    // monto bruto = 1 × 4.06 = 4.06
    // base = round2(4.06 / 1.16) = 3.50
    // iva  = round2(4.06 − 3.50) = 0.56
    await runConfirm({ quantity: 1, unitCostUsd: 4.06, isExempt: false });

    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    const data = tx.expense.create.mock.calls[0][0].data;

    expect(data.amount).toBe(4.06);
    expect(data.baseGeneral).toBe(3.50);
    expect(data.ivaAmount).toBe(0.56);
    expect(data.baseExempt).toBe(0);
  });
});
