/**
 * E2E SaleMode stock — staging only (ep-curly-star).
 *
 * Prueba real contra Monddy:
 * - COMBO (isBundle): descuenta BOM, no el padre
 * - DESCORCHE (isService + saleMode=DESCORCHE): no toca botella ni stock del servicio
 * - voidInvoice restaura con las mismas reglas
 */
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { PrismaService } from "@/common/prisma/prisma.service";
import { InvoicesService } from "@/modules/invoices/invoices.service";
import { InvoiceSequenceService } from "@/modules/invoices/invoice-sequence.service";
import { LiquorSalesService } from "@/modules/invoices/liquor-sales.service";
import { FiscalControlNumberService } from "@/modules/fiscal/fiscal-control-number.service";
import { CreditsService } from "@/modules/credits/credits.service";
import { TasksService } from "@/modules/tasks/tasks.service";
import { ActivityLogService } from "@/modules/activity-log/activity-log.service";
import { FiscalEngineService } from "@/modules/fiscal/fiscal-engine.service";
import { parseBomLines } from "@/common/bom/bundle-bom";
import { classifyLiquorProduct } from "@/modules/invoices/liquor-sales.util";

const STAGING_HOST_MARKER = "ep-curly-star";
const PROD_HOST_MARKER = "ep-super-art";
const ORG_SLUG = "monddy";
const COMBO_SKU = "COMBO-01";
const DESCORCHE_SKU = "DESCORCHE-30";

type StockSnap = { id: number; sku: string | null; name: string; stock: number };

function assertStagingDbUrl(url: string): void {
  if (!url) {
    throw new Error("[e2e] DATABASE_URL vacío — abortando.");
  }
  if (url.includes(PROD_HOST_MARKER)) {
    throw new Error(
      `[e2e] Abortado: DATABASE_URL apunta a producción (${PROD_HOST_MARKER}).`,
    );
  }
  if (!url.includes(STAGING_HOST_MARKER)) {
    throw new Error(
      `[e2e] Abortado: DATABASE_URL debe contener ${STAGING_HOST_MARKER}.`,
    );
  }
}

describe("SaleMode stock e2e (staging Monddy)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let invoices: InvoicesService;

  let orgId: number;
  let sellerId: number;
  let comboId: number;
  let descorcheId: number;
  let bomLines: { productId: number; quantity: number }[];
  let bottleIds: number[];
  let trackedIds: number[];

  /** Bumps temporales para poder facturar con stock 0 en vasos/hielo. */
  const temporaryBumps: { productId: number; amount: number }[] = [];
  let createdInvoiceId: number | null = null;
  let beforeCreate: Map<number, StockSnap> = new Map();

  beforeAll(async () => {
    assertStagingDbUrl(process.env.DATABASE_URL ?? "");

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // No releer .env de prod: DATABASE_URL ya fijado por setup-staging-env.
          ignoreEnvFile: true,
        }),
      ],
      providers: [
        PrismaService,
        InvoicesService,
        InvoiceSequenceService,
        FiscalControlNumberService,
        // Staging puede no tener liquor_day_snapshots; no es el objeto bajo prueba.
        {
          provide: LiquorSalesService,
          useValue: {
            ensureOpeningBeforeSale: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: CreditsService,
          useValue: {
            getOrCreateCredit: jest.fn(),
            chargeForInvoice: jest.fn(),
            reverseChargeForVoid: jest.fn(),
          },
        },
        {
          provide: TasksService,
          useValue: { create: jest.fn() },
        },
        {
          provide: ActivityLogService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: FiscalEngineService,
          useValue: { projectSale: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    invoices = moduleRef.get(InvoicesService);
    await prisma.$connect();

    const liveUrl = (prisma as unknown as { databaseUrl?: string }).databaseUrl;
    if (liveUrl) assertStagingDbUrl(liveUrl);

    const org = await prisma.organization.findFirst({
      where: { slug: ORG_SLUG },
      select: { id: true, slug: true },
    });
    if (!org) {
      throw new Error(`[e2e] Org slug=${ORG_SLUG} no encontrada en staging.`);
    }
    orgId = org.id;

    const member = await prisma.member.findFirst({
      where: { organizationId: orgId, status: "ACTIVE" },
      select: { userId: true },
    });
    if (!member) {
      throw new Error(`[e2e] Sin member ACTIVE en org ${ORG_SLUG}.`);
    }
    sellerId = member.userId;

    const combo = await prisma.product.findFirst({
      where: { organizationId: orgId, sku: COMBO_SKU },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        isBundle: true,
        isService: true,
        bundleComponents: true,
      },
    });
    const descorche = await prisma.product.findFirst({
      where: { organizationId: orgId, sku: DESCORCHE_SKU },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        isBundle: true,
        isService: true,
        bundleComponents: true,
      },
    });

    if (!combo?.isBundle) {
      throw new Error(`[e2e] ${COMBO_SKU} no existe o no es isBundle.`);
    }
    if (!descorche?.isService) {
      throw new Error(`[e2e] ${DESCORCHE_SKU} no existe o no es isService.`);
    }

    comboId = combo.id;
    descorcheId = descorche.id;
    bomLines = parseBomLines(combo.bundleComponents);
    if (bomLines.length === 0) {
      throw new Error(`[e2e] ${COMBO_SKU} sin BOM.`);
    }

    const bomProducts = await prisma.product.findMany({
      where: { id: { in: bomLines.map((l) => l.productId) }, organizationId: orgId },
      select: { id: true, sku: true, name: true, stock: true },
    });
    const nameById = new Map(bomProducts.map((p) => [p.id, p.name]));
    bottleIds = bomLines
      .filter((l) => classifyLiquorProduct(nameById.get(l.productId) ?? "") !== null)
      .map((l) => l.productId);
    if (bottleIds.length === 0) {
      throw new Error(`[e2e] ${COMBO_SKU} BOM sin botella clasificable.`);
    }

    trackedIds = [
      comboId,
      descorcheId,
      ...bomLines.map((l) => l.productId),
    ];

    // Asegurar stock mínimo en componentes BOM (staging suele tener vasos/hielo en 0).
    for (const line of bomLines) {
      const row = bomProducts.find((p) => p.id === line.productId);
      if (!row) {
        throw new Error(`[e2e] Componente BOM ${line.productId} ausente.`);
      }
      const need = line.quantity;
      if (row.stock < need) {
        const amount = need - row.stock;
        await prisma.product.update({
          where: { id: row.id },
          data: { stock: { increment: amount } },
        });
        temporaryBumps.push({ productId: row.id, amount });
      }
    }
  });

  afterAll(async () => {
    try {
      if (createdInvoiceId != null) {
        const stillOpen = await prisma.invoice.findFirst({
          where: { id: createdInvoiceId, organizationId: orgId, deletedAt: null },
          select: { id: true, status: true },
        });
        if (stillOpen && stillOpen.status !== "CANCELLED") {
          await invoices.voidInvoice(
            createdInvoiceId,
            orgId,
            sellerId,
            "e2e cleanup: sale-mode-stock",
          );
        }
      }
    } catch (err) {
      console.error("[e2e] cleanup void failed:", err);
    }

    try {
      for (const bump of temporaryBumps) {
        await prisma.product.update({
          where: { id: bump.productId },
          data: { stock: { decrement: bump.amount } },
        });
      }
    } catch (err) {
      console.error("[e2e] cleanup stock bump rollback failed:", err);
    }

    await prisma?.$disconnect();
    await moduleRef?.close();
  });

  async function snapshot(ids: number[]): Promise<Map<number, StockSnap>> {
    const rows = await prisma.product.findMany({
      where: { id: { in: ids }, organizationId: orgId },
      select: { id: true, sku: true, name: true, stock: true },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  it("combo baja BOM; DESCORCHE no baja botella; void restaura", async () => {
    assertStagingDbUrl(process.env.DATABASE_URL ?? "");

    beforeCreate = await snapshot(trackedIds);
    const comboBefore = beforeCreate.get(comboId)!;
    const descorcheBefore = beforeCreate.get(descorcheId)!;

    const invoice = await invoices.create(
      {
        items: [
          { productId: comboId, quantity: 1, saleMode: "STANDARD" },
          { productId: descorcheId, quantity: 1, saleMode: "DESCORCHE" },
        ],
        paymentMethod: "CASH",
        notes: "e2e sale-mode-stock",
      },
      orgId,
      sellerId,
    );

    expect(invoice).toBeTruthy();
    createdInvoiceId = invoice!.id;

    const afterCreate = await snapshot(trackedIds);
    const deltas: Record<string, number> = {};
    for (const id of trackedIds) {
      const b = beforeCreate.get(id)!;
      const a = afterCreate.get(id)!;
      deltas[b.sku ?? String(id)] = a.stock - b.stock;
    }
    // eslint-disable-next-line no-console
    console.log("[e2e] stock deltas after create:", deltas);

    // Combo padre: no es fuente de inventario
    expect(afterCreate.get(comboId)!.stock).toBe(comboBefore.stock);

    // Servicio DESCORCHE: stock del padre no cambia
    expect(afterCreate.get(descorcheId)!.stock).toBe(descorcheBefore.stock);

    // Componentes BOM del combo disminuyen exactamente qty BOM × 1
    for (const line of bomLines) {
      const before = beforeCreate.get(line.productId)!;
      const after = afterCreate.get(line.productId)!;
      expect(after.stock).toBe(before.stock - line.quantity);
    }

    // Botella(s) del combo: solo el decremento del combo (DESCORCHE no suma)
    for (const bottleId of bottleIds) {
      const bomQty =
        bomLines.find((l) => l.productId === bottleId)?.quantity ?? 0;
      const before = beforeCreate.get(bottleId)!;
      const after = afterCreate.get(bottleId)!;
      expect(after.stock).toBe(before.stock - bomQty);
    }

    const saleModes = (invoice!.items ?? []).map(
      (i: { productId: number; saleMode?: string | null }) => ({
        productId: i.productId,
        saleMode: i.saleMode,
      }),
    );
    expect(saleModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ productId: comboId, saleMode: "STANDARD" }),
        expect.objectContaining({
          productId: descorcheId,
          saleMode: "DESCORCHE",
        }),
      ]),
    );

    await invoices.voidInvoice(
      createdInvoiceId,
      orgId,
      sellerId,
      "e2e sale-mode-stock void path",
    );

    const afterVoid = await snapshot(trackedIds);
    for (const id of trackedIds) {
      expect(afterVoid.get(id)!.stock).toBe(beforeCreate.get(id)!.stock);
    }
    createdInvoiceId = null;

    // eslint-disable-next-line no-console
    console.log("[e2e] stock restored after void — PASS");
  });
});
