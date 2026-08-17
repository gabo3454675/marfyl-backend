import { BadRequestException } from "@nestjs/common";
import { FloorOrderStatus } from "@prisma/client";
import { FloorOrdersService } from "./floor-orders.service";

type ProductRow = {
  id: number;
  name: string;
  salePrice: number;
  stock: number;
  reservedStock: number;
  isActive: boolean;
  isBundle: boolean;
  isService: boolean;
  bundleComponents: unknown;
};

const ORG_ID = 1;
const USER_ID = 10;

function makeProduct(
  overrides: Partial<ProductRow> & { id: number; name: string },
): ProductRow {
  return {
    salePrice: 30,
    stock: 100,
    reservedStock: 0,
    isActive: true,
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
});
const SODA = makeProduct({
  id: 102,
  name: "MINALBA SPARKLING SODA LATA 355 ML",
  salePrice: 2,
});
const VASOS = makeProduct({
  id: 201,
  name: "VASOS PLASTICOS LOS LLANOS N° 27",
  salePrice: 1,
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

describe("FloorOrdersService — comanda combo/descorche (Prisma mocks)", () => {
  let service: FloorOrdersService;
  let prisma: Record<string, any>;
  let invoices: { create: jest.Mock };
  let reservedUpdates: Array<{ id: number; data: Record<string, unknown> }>;
  let lastFloorOrderCreate: Record<string, unknown> | null;

  beforeEach(() => {
    reservedUpdates = [];
    lastFloorOrderCreate = null;

    const tx = {
      product: {
        findUnique: jest.fn(async ({ where }: { where: { id: number } }) =>
          CATALOG.get(where.id),
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: number };
            data: Record<string, unknown>;
          }) => {
            reservedUpdates.push({ id: where.id, data });
            return CATALOG.get(where.id);
          },
        ),
      },
      floorOrder: {
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 55,
          ...data,
          items: [],
          createdBy: { id: USER_ID, fullName: "Test" },
        })),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };

    prisma = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ slug: "monddy", nombre: "Monddy" }),
      },
      company: { findFirst: jest.fn().mockResolvedValue({ id: 50 }) },
      product: {
        findMany: jest.fn(async ({ where }: { where: { id: { in: number[] } } }) => {
          const ids: number[] = where?.id?.in ?? [];
          return ids.map((id) => CATALOG.get(id)).filter(Boolean);
        }),
        findUnique: jest.fn(async ({ where }: { where: { id: number } }) =>
          CATALOG.get(where.id),
        ),
        update: jest.fn(),
      },
      floorOrder: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          lastFloorOrderCreate = data;
          return {
            id: 55,
            status: FloorOrderStatus.DRAFT,
            ...data,
            items: (data as { items?: { create: unknown[] } }).items?.create ?? [],
            createdBy: { id: USER_ID, fullName: "Test" },
          };
        }),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      floorTable: { findFirst: jest.fn() },
      floorTableAccount: { findFirst: jest.fn(), create: jest.fn() },
      customer: { findUnique: jest.fn(), findFirst: jest.fn() },
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    invoices = { create: jest.fn().mockResolvedValue({ id: 9001 }) };

    service = new FloorOrdersService(
      prisma as any,
      invoices as any,
      { emitToOrg: jest.fn() } as any,
    );
  });

  it("comanda acepta isBundle e isService (no rechaza)", async () => {
    const order = await service.create(ORG_ID, USER_ID, {
      tableLabel: "M1",
      items: [
        { productId: COMBO.id, quantity: 1, saleMode: "STANDARD" },
        { productId: DESCORCHE.id, quantity: 1, saleMode: "DESCORCHE" },
      ],
    } as any);

    expect(order.id).toBe(55);
    const itemsCreate = (
      lastFloorOrderCreate as {
        items: { create: Array<{ productId: number; saleMode: string }> };
      }
    ).items.create;
    expect(itemsCreate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: COMBO.id, saleMode: "STANDARD" }),
        expect.objectContaining({
          productId: DESCORCHE.id,
          saleMode: "DESCORCHE",
        }),
      ]),
    );
  });

  it("rechaza botella + saleMode=DESCORCHE al crear comanda", async () => {
    await expect(
      service.create(ORG_ID, USER_ID, {
        tableLabel: "M1",
        items: [{ productId: BOTTLE.id, quantity: 1, saleMode: "DESCORCHE" }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.floorOrder.create).not.toHaveBeenCalled();
  });

  it("send reserva solo BOM de combo (no padre) y acompañamientos de descorche (no botella)", async () => {
    prisma.floorOrder.findFirst.mockResolvedValue({
      id: 55,
      organizationId: ORG_ID,
      status: FloorOrderStatus.DRAFT,
      items: [
        { productId: COMBO.id, quantity: 1, saleMode: "STANDARD" },
        { productId: DESCORCHE.id, quantity: 1, saleMode: "DESCORCHE" },
      ],
    });
    prisma.floorOrder.update = jest.fn(); // getOne path unused when DRAFT→SENT via tx

    await service.send(ORG_ID, 55);

    const reservedIds = reservedUpdates.map((u) => u.id);
    expect(reservedIds).not.toContain(COMBO.id);
    expect(reservedIds).not.toContain(DESCORCHE.id);
    // Combo reserva bottle+soda; descorche solo vasos (botella×1 solo del combo)
    expect(reservedUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: BOTTLE.id,
          data: expect.objectContaining({
            reservedStock: { increment: 1 },
          }),
        }),
        expect.objectContaining({
          id: SODA.id,
          data: expect.objectContaining({
            reservedStock: { increment: 2 },
          }),
        }),
        expect.objectContaining({
          id: VASOS.id,
          data: expect.objectContaining({
            reservedStock: { increment: 4 },
          }),
        }),
      ]),
    );
    // Si descorche también reservara botella serían 2
    const bottleReserves = reservedUpdates.filter((u) => u.id === BOTTLE.id);
    expect(bottleReserves).toHaveLength(1);
    expect(bottleReserves[0].data).toEqual({
      reservedStock: { increment: 1 },
    });
  });

  it("cancel libera las mismas reservas (coherente con send)", async () => {
    prisma.floorOrder.findFirst.mockResolvedValue({
      id: 55,
      organizationId: ORG_ID,
      status: FloorOrderStatus.SENT,
      items: [
        { productId: COMBO.id, quantity: 1, saleMode: "STANDARD" },
        { productId: DESCORCHE.id, quantity: 1, saleMode: "DESCORCHE" },
      ],
    });

    await service.cancel(ORG_ID, 55);

    const released = reservedUpdates.filter(
      (u) =>
        u.data.reservedStock &&
        typeof u.data.reservedStock === "object" &&
        "decrement" in (u.data.reservedStock as object),
    );
    expect(released.map((u) => u.id)).not.toContain(COMBO.id);
    expect(released.map((u) => u.id)).not.toContain(DESCORCHE.id);
    expect(released).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: BOTTLE.id,
          data: { reservedStock: { decrement: 1 } },
        }),
        expect.objectContaining({
          id: SODA.id,
          data: { reservedStock: { decrement: 2 } },
        }),
        expect.objectContaining({
          id: VASOS.id,
          data: { reservedStock: { decrement: 4 } },
        }),
      ]),
    );
  });

  it("charge copia saleMode Floor→Invoice (invoices.create)", async () => {
    prisma.floorOrder.findFirst.mockResolvedValue({
      id: 55,
      organizationId: ORG_ID,
      status: FloorOrderStatus.READY,
      chargedInvoiceId: null,
      paymentMode: "INMEDIATO",
      isOpen: false,
      customerName: "Mesa 1",
      customerId: null,
      tableLabel: "M1",
      notes: null,
      items: [
        { productId: COMBO.id, quantity: 1, saleMode: "STANDARD" },
        { productId: DESCORCHE.id, quantity: 1, saleMode: "DESCORCHE" },
      ],
    });
    prisma.floorOrder.update.mockResolvedValue({
      id: 55,
      status: FloorOrderStatus.CHARGED,
      chargedInvoiceId: 9001,
      items: [],
      createdBy: { id: USER_ID, fullName: "Test" },
    });

    await service.charge(ORG_ID, USER_ID, 55, {
      paymentMethod: "CASH",
    } as any);

    expect(invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({
            productId: COMBO.id,
            quantity: 1,
            saleMode: "STANDARD",
          }),
          expect.objectContaining({
            productId: DESCORCHE.id,
            quantity: 1,
            saleMode: "DESCORCHE",
          }),
        ]),
      }),
      ORG_ID,
      USER_ID,
      expect.objectContaining({
        releaseReserved: expect.arrayContaining([
          expect.objectContaining({ productId: BOTTLE.id, quantity: 1 }),
          expect.objectContaining({ productId: SODA.id, quantity: 2 }),
          expect.objectContaining({ productId: VASOS.id, quantity: 4 }),
        ]),
      }),
    );
    const releaseArg = invoices.create.mock.calls[0][3].releaseReserved as Array<{
      productId: number;
      quantity: number;
    }>;
    expect(releaseArg.map((r) => r.productId)).not.toContain(COMBO.id);
    expect(releaseArg.map((r) => r.productId)).not.toContain(DESCORCHE.id);
    // release de descorche no incluye botella extra
    expect(releaseArg.filter((r) => r.productId === BOTTLE.id)).toEqual([
      { productId: BOTTLE.id, quantity: 1 },
    ]);
  });
});
