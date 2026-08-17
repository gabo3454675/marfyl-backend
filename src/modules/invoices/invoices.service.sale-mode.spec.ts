import { BadRequestException } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";

type ProductRow = {
  id: number;
  name: string;
  salePrice: number;
  stock: number;
  reservedStock: number;
  isExempt: boolean;
  isBundle: boolean;
  isService: boolean;
  bundleComponents: unknown;
};

const ORG_ID = 1;
const SELLER_ID = 10;

function makeProduct(overrides: Partial<ProductRow> & { id: number; name: string }): ProductRow {
  return {
    salePrice: 30,
    stock: 100,
    reservedStock: 0,
    isExempt: false,
    isBundle: false,
    isService: false,
    bundleComponents: null,
    ...overrides,
  };
}

const BOTTLE = makeProduct({
  id: 101,
  name: "Whisky Buchanan's 18",
  salePrice: 80,
  stock: 50,
});
const SODA = makeProduct({
  id: 102,
  name: "MINALBA SPARKLING SODA LATA 355 ML",
  salePrice: 2,
  stock: 200,
});
const VASOS = makeProduct({
  id: 201,
  name: "VASOS PLASTICOS LOS LLANOS N° 27",
  salePrice: 1,
  stock: 500,
});
const COMBO = makeProduct({
  id: 100,
  name: "Combo Buch 18",
  salePrice: 95,
  isBundle: true,
  bundleComponents: [
    { productId: 101, quantity: 1 },
    { productId: 102, quantity: 2 },
  ],
});
const DESCORCHE = makeProduct({
  id: 200,
  name: "DESCORCHE-30",
  salePrice: 30,
  isService: true,
  bundleComponents: [
    { productId: 101, quantity: 1 },
    { productId: 201, quantity: 4 },
  ],
});

const CATALOG = new Map<number, ProductRow>([
  [BOTTLE.id, BOTTLE],
  [SODA.id, SODA],
  [VASOS.id, VASOS],
  [COMBO.id, COMBO],
  [DESCORCHE.id, DESCORCHE],
]);

describe("InvoicesService — saleMode combo/descorche (Prisma mocks)", () => {
  let service: InvoicesService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    company: { findFirst: jest.Mock; create: jest.Mock };
    tasaHistorica: { create: jest.Mock };
    product: { findMany: jest.Mock; update: jest.Mock };
    productVariant: { findMany: jest.Mock };
    inventoryMovement: { create: jest.Mock };
    invoice: { create: jest.Mock; findUnique: jest.Mock; findFirst: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let liquorSales: { ensureOpeningBeforeSale: jest.Mock };
  let fiscalControlNumber: { allocateControlNumber: jest.Mock };
  let invoiceSequence: { allocateNext: jest.Mock };
  let activityLog: { log: jest.Mock };
  let fiscalEngine: { projectSale: jest.Mock };
  let stockUpdates: Array<{ id: number; data: Record<string, unknown> }>;
  let lastInvoiceCreateData: Record<string, unknown> | null;

  beforeEach(() => {
    stockUpdates = [];
    lastInvoiceCreateData = null;

    const tx = {
      product: {
        update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
          stockUpdates.push({ id: where.id, data });
          return CATALOG.get(where.id);
        }),
      },
      invoice: {
        create: jest.fn(async ({ data, include }: { data: Record<string, unknown>; include?: unknown }) => {
          lastInvoiceCreateData = data;
          return {
            id: 9001,
            consecutiveNumber: 1,
            totalAmount: 30,
            customer: null,
            items: (data as { items?: { create: unknown[] } }).items?.create ?? [],
            paymentLines: [],
            pagos: [],
            include,
          };
        }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 9001,
          ...data,
          customer: null,
          items: [],
        })),
      },
    };

    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({
          exchangeRate: 1,
          slug: "monddy",
          nombre: "Monddy",
        }),
      },
      company: {
        findFirst: jest.fn().mockResolvedValue({ id: 50 }),
        create: jest.fn(),
      },
      tasaHistorica: {
        create: jest.fn().mockResolvedValue({ id: 7 }),
      },
      product: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: number[] } } }) => {
          const ids: number[] = where?.id?.in ?? [];
          return ids.map((id) => CATALOG.get(id)).filter(Boolean);
        }),
        update: jest.fn(),
      },
      productVariant: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryMovement: { create: jest.fn() },
      invoice: {
        create: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          id: 9001,
          items: [],
          customer: null,
          paymentLines: [],
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    liquorSales = { ensureOpeningBeforeSale: jest.fn().mockResolvedValue(undefined) };
    fiscalControlNumber = { allocateControlNumber: jest.fn().mockResolvedValue("CTRL-1") };
    invoiceSequence = { allocateNext: jest.fn().mockResolvedValue(1) };
    activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    fiscalEngine = { projectSale: jest.fn().mockResolvedValue(undefined) };

    service = new InvoicesService(
      prisma as any,
      { getOrCreateCredit: jest.fn(), chargeForInvoice: jest.fn(), reverseChargeForVoid: jest.fn() } as any,
      { create: jest.fn() } as any,
      activityLog as any,
      fiscalEngine as any,
      fiscalControlNumber as any,
      invoiceSequence as any,
      liquorSales as any,
    );
  });

  it("rechaza botella (no isService) con saleMode=DESCORCHE", async () => {
    await expect(
      service.create(
        {
          items: [{ productId: BOTTLE.id, quantity: 1, saleMode: "DESCORCHE" }],
          paymentMethod: "CASH",
        } as any,
        ORG_ID,
        SELLER_ID,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("combo: descuenta solo componentes BOM, no el padre", async () => {
    await service.create(
      {
        items: [{ productId: COMBO.id, quantity: 2, saleMode: "STANDARD" }],
        paymentMethod: "CASH",
      } as any,
      ORG_ID,
      SELLER_ID,
    );

    const decrementedIds = stockUpdates.map((u) => u.id);
    expect(decrementedIds).not.toContain(COMBO.id);
    expect(stockUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: BOTTLE.id,
          data: expect.objectContaining({ stock: { decrement: 2 } }),
        }),
        expect.objectContaining({
          id: SODA.id,
          data: expect.objectContaining({ stock: { decrement: 4 } }),
        }),
      ]),
    );
    expect(stockUpdates).toHaveLength(2);
  });

  it("DESCORCHE + isService: no toca botella; sí acompañamientos BOM", async () => {
    await service.create(
      {
        items: [{ productId: DESCORCHE.id, quantity: 1, saleMode: "DESCORCHE" }],
        paymentMethod: "CASH",
      } as any,
      ORG_ID,
      SELLER_ID,
    );

    const decrementedIds = stockUpdates.map((u) => u.id);
    expect(decrementedIds).not.toContain(BOTTLE.id);
    expect(decrementedIds).not.toContain(DESCORCHE.id);
    expect(stockUpdates).toEqual([
      expect.objectContaining({
        id: VASOS.id,
        data: expect.objectContaining({ stock: { decrement: 4 } }),
      }),
    ]);
  });

  it("persiste saleMode en ítems de factura", async () => {
    await service.create(
      {
        items: [
          { productId: DESCORCHE.id, quantity: 1, saleMode: "DESCORCHE" },
          { productId: COMBO.id, quantity: 1, saleMode: "STANDARD" },
        ],
        paymentMethod: "CASH",
      } as any,
      ORG_ID,
      SELLER_ID,
    );

    const itemsCreate = (lastInvoiceCreateData as { items: { create: Array<{ productId: number; saleMode: string }> } })
      .items.create;
    expect(itemsCreate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: DESCORCHE.id, saleMode: "DESCORCHE" }),
        expect.objectContaining({ productId: COMBO.id, saleMode: "STANDARD" }),
      ]),
    );
  });

  it("void restaura stock con las mismas reglas (combo/descorche)", async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 9001,
      organizationId: ORG_ID,
      status: "PAID",
      deletedAt: null,
      paymentMethod: "CASH",
      paymentStatus: "paid",
      totalAmount: 125,
      consecutiveNumber: 1,
      customerId: null,
      customer: { name: "Walk-in" },
      items: [
        {
          quantity: 1,
          saleMode: "DESCORCHE",
          productId: DESCORCHE.id,
          product: DESCORCHE,
        },
        {
          quantity: 1,
          saleMode: "STANDARD",
          productId: COMBO.id,
          product: COMBO,
        },
      ],
    });

    await service.voidInvoice(9001, ORG_ID, SELLER_ID, "error de cobro");

    const restoredIds = stockUpdates.map((u) => u.id);
    expect(restoredIds).not.toContain(COMBO.id);
    expect(restoredIds).not.toContain(DESCORCHE.id);
    // Combo restaura botella×1; descorche no suma botella (si sumara serían 2)
    expect(stockUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: VASOS.id,
          data: expect.objectContaining({ stock: { increment: 4 } }),
        }),
        expect.objectContaining({
          id: BOTTLE.id,
          data: expect.objectContaining({ stock: { increment: 1 } }),
        }),
        expect.objectContaining({
          id: SODA.id,
          data: expect.objectContaining({ stock: { increment: 2 } }),
        }),
      ]),
    );
    expect(stockUpdates).toHaveLength(3);
  });
});
