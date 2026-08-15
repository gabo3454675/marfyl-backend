import { PurchasesImportService } from "./purchases-import.service";
import {
  parseMonddyPurchasesExcel,
} from "./monddy-purchases.parser";
import type {
  ParsedPurchaseGroup,
  ParsedPurchaseLine,
} from "./monddy-purchases.parser";

// Mockeamos el parser para no depender de archivos Excel reales.
// El servicio llama a parseMonddyPurchasesExcel(buffer) de forma síncrona
// en preview() y en confirm(), por lo que el mock usa mockReturnValue.
jest.mock("./monddy-purchases.parser", () => ({
  parseMonddyPurchasesExcel: jest.fn(),
}));

// --- Fixtures ---

const makeLine = (
  overrides: Partial<ParsedPurchaseLine> = {},
): ParsedPurchaseLine => ({
  rowNum: 2,
  sku: "ABC-001",
  shortName: "Producto A",
  description: "Producto A",
  quantity: 5,
  unitCostUsd: 10,
  salePriceUsd: 0,
  isExempt: false,
  status: "",
  ...overrides,
});

const makeGroup = (
  overrides: Partial<ParsedPurchaseGroup> = {},
): ParsedPurchaseGroup => ({
  groupIndex: 1,
  monthLabel: "AGOSTO",
  purchaseDate: "2026-08-11",
  invoiceRef: "FACT-001",
  supplierName: "PROVEEDOR A",
  lines: [makeLine()],
  ...overrides,
});

// Misma plantilla que buildImportKey() del servicio
// (`monddy-compra:${purchaseDate}:${supplierName}:${invoiceRef}:${groupIndex}`).
const IMPORT_KEY = "monddy-compra:2026-08-11:PROVEEDOR A:FACT-001:1";

const productRow = {
  id: 1,
  name: "Producto A",
  sku: "ABC-001",
  barcode: null,
  costPrice: 8,
  salePrice: 12,
  stock: 10,
  isBundle: false,
  isService: false,
};

// Mock plano de PrismaService (patrón del spec de sales-import).
// Nota: product.update y expense.create/inventoryMovement.create se ejecutan
// dentro del tx del $transaction, no sobre this.prisma directamente.
const mockPrisma = {
  product: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  expense: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
  expenseCategory: { findFirst: jest.fn() },
  supplier: { findFirst: jest.fn(), create: jest.fn() },
  inventoryMovement: { create: jest.fn() },
  // getCompanyIdFromOrganization (helper real) usa estos dos:
  organization: { findUnique: jest.fn() },
  company: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};

describe("PurchasesImportService", () => {
  let service: PurchasesImportService;
  let tx: {
    expense: { create: jest.Mock };
    inventoryMovement: { create: jest.Mock };
    product: { update: jest.Mock };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // El parser mockeado siempre devuelve el mismo grupo por defecto.
    (parseMonddyPurchasesExcel as jest.Mock).mockReturnValue([makeGroup()]);

    // Mocks para que preview() corra dentro de confirm() y calcule
    // alreadyImported=false por defecto.
    mockPrisma.product.findMany.mockResolvedValue([productRow]);
    mockPrisma.expense.findMany.mockResolvedValue([]);

    // Mocks del flujo de confirm().
    mockPrisma.expenseCategory.findFirst.mockResolvedValue({ id: 10 });
    mockPrisma.supplier.findFirst.mockResolvedValue(null);
    mockPrisma.supplier.create.mockResolvedValue({ id: 20 });
    mockPrisma.product.findFirst.mockResolvedValue(null);
    mockPrisma.product.findUnique.mockResolvedValue({
      id: 1,
      name: "Producto A",
      stock: 10,
      isBundle: false,
      isService: false,
    });
    mockPrisma.product.create.mockResolvedValue({ id: 1 });
    // getCompanyIdFromOrganization → companyId = 100
    mockPrisma.organization.findUnique.mockResolvedValue({
      nombre: "Mi Org",
    });
    mockPrisma.company.findFirst.mockResolvedValue({ id: 100 });

    // Stub de transacción: cada caso define su propio tx.
    tx = {
      expense: { create: jest.fn().mockResolvedValue({ id: 900 }) },
      inventoryMovement: {
        create: jest.fn().mockResolvedValue({ id: 901 }),
      },
      product: { update: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    mockPrisma.$transaction = jest
      .fn()
      .mockImplementation(async (fn) => fn(tx));

    service = new PurchasesImportService(mockPrisma as any);
  });

  describe("preview", () => {
    const previewParams = {
      buffer: Buffer.from("compra"),
      fileName: "compra-monddy.xlsx",
      organizationId: 7,
    };

    it("1. producto encontrado: currentStock=10, stockDelta=5, finalStock=15", async () => {
      const result = await service.preview(previewParams);

      expect(result.groups).toHaveLength(1);
      const line = result.groups[0].lines[0];
      expect(line.matchMethod).toBe("sku");
      expect(line.willCreate).toBe(false);
      expect(line.productId).toBe(1);
      expect(line.productName).toBe("Producto A");
      // Lógica de proyección: stock actual + cantidad (entrada "in")
      expect(line.currentStock).toBe(10);
      expect(line.stockDelta).toBe(5);
      expect(line.finalStock).toBe(15);
    });

    it("2. willCreate (producto nuevo): currentStock=0, stockDelta=quantity, finalStock=quantity", async () => {
      (parseMonddyPurchasesExcel as jest.Mock).mockReturnValue([
        makeGroup({
          lines: [
            makeLine({
              sku: "NUEVO-999",
              description: "Producto Nuevo",
              quantity: 3,
              unitCostUsd: 5,
            }),
          ],
        }),
      ]);
      // Sin productos en catálogo → resolveProduct devuelve { product: null, method: "create" }
      mockPrisma.product.findMany.mockResolvedValue([]);

      const result = await service.preview(previewParams);

      const line = result.groups[0].lines[0];
      expect(line.matchMethod).toBe("create");
      expect(line.willCreate).toBe(true);
      expect(line.productId).toBeNull();
      expect(line.productName).toBeNull();
      // Producto nuevo: nace con stock 0 y se le agrega toda la cantidad
      expect(line.currentStock).toBe(0);
      expect(line.stockDelta).toBe(3);
      expect(line.finalStock).toBe(3);
    });

    it("3. sin match (defensivo): proyección null en los tres campos", async () => {
      // resolveProduct nunca devuelve "none" en la implementación real, pero el
      // tipo lo permite y preview() lo maneja: cuando el matchMethod es "none",
      // matched=false y projectStock devuelve null en los tres campos.
      (service as any).resolveProduct = jest.fn().mockReturnValue({
        product: { ...productRow },
        method: "none",
      });

      const result = await service.preview(previewParams);

      const line = result.groups[0].lines[0];
      expect(line.matchMethod).toBe("none");
      expect(line.willCreate).toBe(false);
      // Línea sin match confiable → no se proyecta stock (defensivo)
      expect(line.currentStock).toBeNull();
      expect(line.stockDelta).toBeNull();
      expect(line.finalStock).toBeNull();
    });
  });

  describe("confirm", () => {
    const confirmParams = {
      buffer: Buffer.from("compra"),
      fileName: "compra-monddy.xlsx",
      organizationId: 7,
      userId: 3,
    };

    it("4. incrementa stock: data.stock.increment === quantity", async () => {
      const result = await service.confirm(confirmParams);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            stock: { increment: 5 },
          }),
        }),
      );
      // Lógica: el delta aplicado coincide con la cantidad de la línea
      expect(result.stockAdded).toBe(5);
      expect(result.movementsCreated).toBe(1);
    });

    it("5. actualiza costPrice: data.costPrice === unitCostUsd", async () => {
      await service.confirm(confirmParams);

      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            costPrice: 10, // unitCostUsd de la línea
          }),
        }),
      );
    });

    it("6. crea inventoryMovement con type COMPRA y quantity correcto", async () => {
      await service.confirm(confirmParams);

      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: "COMPRA",
            quantity: 5,
            unitCostAtTransaction: 10,
            product: { connect: { id: 1 } },
          }),
        }),
      );
    });

    it("7. crea expense con importKey que empieza por monddy-compra:", async () => {
      await service.confirm(confirmParams);

      expect(tx.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            importKey: expect.stringMatching(/^monddy-compra:/),
          }),
        }),
      );
      // El importKey completo se construye con la plantilla del servicio
      expect(tx.expense.create.mock.calls[0][0].data.importKey).toBe(
        IMPORT_KEY,
      );
    });

    it("8. skipImported: omite grupos ya importados; con false reimporta", async () => {
      // Marcamos el grupo como ya importado para el preview (alreadyImported=true)
      mockPrisma.expense.findMany.mockResolvedValue([
        { importKey: IMPORT_KEY, description: "compra ya importada" },
      ]);

      // skipImported=true (default): NO incrementa ni crea nada
      const resultSkipped = await service.confirm({
        ...confirmParams,
        skipImported: true,
      });
      expect(resultSkipped.expensesSkipped).toBe(1);
      expect(resultSkipped.expensesCreated).toBe(0);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(tx.product.update).not.toHaveBeenCalled();
      expect(tx.inventoryMovement.create).not.toHaveBeenCalled();

      // skipImported=false: reimporta y vuelve a incrementar (idempotencia controlada)
      jest.clearAllMocks();
      const resultImported = await service.confirm({
        ...confirmParams,
        skipImported: false,
      });
      expect(resultImported.expensesSkipped).toBe(0);
      expect(resultImported.expensesCreated).toBe(1);
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stock: { increment: 5 },
          }),
        }),
      );
      expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
    });
  });
});
