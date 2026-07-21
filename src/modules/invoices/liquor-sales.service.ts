import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  BEER_STYLE_LABELS,
  BEER_STYLE_ORDER,
  BOTTLES_PER_CASE,
  BOTTLES_PER_TOBO,
  LIQUOR_BUCKET_LABELS,
  TOBOS_PER_CASE,
  classifyBeerStyle,
  classifyLiquorProduct,
  packFromBottles,
  type BeerStyle,
  type LiquorBucket,
} from "./liquor-sales.util";

function todayCaracas(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function yesterdayCaracas(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Caracas",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  const utc = Date.UTC(y, m - 1, d);
  const prev = new Date(utc - 24 * 60 * 60 * 1000);
  return prev.toISOString().slice(0, 10);
}

type RawRow = {
  productId: number;
  sku: string | null;
  name: string;
  quantity: number;
  usd: number;
};

@Injectable()
export class LiquorSalesService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadDayRows(
    organizationId: number,
    day: string,
  ): Promise<RawRow[]> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      SELECT
        p.id AS "productId",
        p.sku,
        p.name,
        SUM(ii.quantity)::int AS quantity,
        ROUND(COALESCE(SUM(ii.subtotal), 0)::numeric, 2) AS usd
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      JOIN products p ON p.id = ii."productId"
      WHERE i."organizationId" = $1
        AND i.status = 'PAID'
        AND i."deletedAt" IS NULL
        AND p."isBundle" = false
        AND p."isService" = false
        AND ((i."issueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Caracas')::date = $2::date
        AND (
          i."legacyImportKey" IS NULL
          OR i."legacyImportKey" NOT LIKE 'CUADRE-DIARIO-%'
        )
      GROUP BY p.id, p.sku, p.name
      ORDER BY SUM(ii.quantity) DESC
      `,
      organizationId,
      day,
    )) as {
      productId: number;
      sku: string | null;
      name: string;
      quantity: number;
      usd: string | number;
    }[];

    return rows.map((r) => ({
      productId: r.productId,
      sku: r.sku,
      name: r.name,
      quantity: Number(r.quantity),
      usd: Number(r.usd),
    }));
  }

  private async findLatestLiquorDay(
    organizationId: number,
  ): Promise<string | null> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `
      SELECT ((i."issueDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Caracas')::date::text AS day
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      JOIN products p ON p.id = ii."productId"
      WHERE i."organizationId" = $1
        AND i.status = 'PAID'
        AND i."deletedAt" IS NULL
        AND p."isBundle" = false
        AND p."isService" = false
        AND (
          i."legacyImportKey" IS NULL
          OR i."legacyImportKey" NOT LIKE 'CUADRE-DIARIO-%'
        )
        AND (
          UPPER(p.name) LIKE '%CERVEZA%'
          OR UPPER(p.name) LIKE '%PILSEN%'
          OR UPPER(p.name) LIKE '%SOLERA%'
          OR UPPER(p.name) LIKE '%WHISK%'
          OR UPPER(p.name) LIKE '%BUCHAN%'
          OR UPPER(p.name) LIKE '%OLD PAR%'
          OR UPPER(p.name) LIKE '%RON %'
          OR UPPER(p.name) LIKE '%VINO %'
          OR UPPER(p.name) LIKE '%CARORE%'
          OR UPPER(p.name) LIKE '%BOTELLA RETORNABLE%'
        )
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 1
      `,
      organizationId,
    )) as { day: string }[];
    return rows[0]?.day ?? null;
  }

  /**
   * Asegura snapshots de apertura para productos de licor del día.
   * - Sin snapshot: opening ≈ stock_actual + vendido_día (stock ya bajó con las ventas).
   * - Con snapshot inválido (opening < vendido): repara al mínimo coherente.
   */
  async ensureDaySnapshots(
    organizationId: number,
    day: string,
    soldByProduct: Map<number, { name: string; quantity: number }>,
  ): Promise<Map<number, number>> {
    const dayDate = new Date(`${day}T00:00:00.000Z`);
    const existing = await this.prisma.liquorDaySnapshot.findMany({
      where: {
        organizationId,
        day: dayDate,
      },
    });
    const openingByProduct = new Map<number, number>();
    for (const s of existing) {
      openingByProduct.set(s.productId, s.openingStock);
    }

    const productIds = new Set<number>([
      ...openingByProduct.keys(),
      ...soldByProduct.keys(),
    ]);

    // Productos licor activos de la org (para apertura del día actual sin ventas aún)
    if (day === todayCaracas()) {
      const active = await this.prisma.product.findMany({
        where: {
          organizationId,
          isActive: true,
          isBundle: false,
          isService: false,
        },
        select: { id: true, name: true, stock: true },
      });
      for (const p of active) {
        if (classifyLiquorProduct(p.name)) {
          productIds.add(p.id);
          if (!soldByProduct.has(p.id)) {
            soldByProduct.set(p.id, { name: p.name, quantity: 0 });
          }
        }
      }
    }

    const missingIds = [...productIds].filter((id) => !openingByProduct.has(id));
    const repairIds = [...productIds].filter((id) => {
      const sold = soldByProduct.get(id)?.quantity ?? 0;
      const opening = openingByProduct.get(id);
      return opening !== undefined && sold > opening;
    });

    const needStockIds = [...new Set([...missingIds, ...repairIds])];
    if (needStockIds.length === 0) {
      return openingByProduct;
    }

    const products = await this.prisma.product.findMany({
      where: { id: { in: needStockIds }, organizationId },
      select: { id: true, name: true, stock: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const toCreate: {
      organizationId: number;
      day: Date;
      productId: number;
      openingStock: number;
    }[] = [];

    for (const id of missingIds) {
      const p = productById.get(id);
      if (!p) continue;
      if (!classifyLiquorProduct(p.name) && !soldByProduct.has(p.id)) continue;
      const sold = soldByProduct.get(p.id)?.quantity ?? 0;
      // stock actual + vendido = apertura reconstruida (sirve hoy y días pasados).
      // Como mínimo, nunca menos de lo vendido ese día.
      const openingStock = Math.max(0, p.stock + sold, sold);
      toCreate.push({
        organizationId,
        day: dayDate,
        productId: p.id,
        openingStock,
      });
      openingByProduct.set(p.id, openingStock);
    }

    if (toCreate.length > 0) {
      await this.prisma.liquorDaySnapshot.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }

    // Repara snapshots congelados en 0 (u otro valor) cuando ya hay ventas mayores.
    for (const id of repairIds) {
      const p = productById.get(id);
      const sold = soldByProduct.get(id)?.quantity ?? 0;
      const prev = openingByProduct.get(id) ?? 0;
      const reconstructed = p
        ? Math.max(0, p.stock + sold, sold)
        : Math.max(sold, prev);
      const openingStock = Math.max(prev, reconstructed, sold);
      if (openingStock <= prev) continue;
      await this.prisma.liquorDaySnapshot.updateMany({
        where: {
          organizationId,
          day: dayDate,
          productId: id,
        },
        data: { openingStock },
      });
      openingByProduct.set(id, openingStock);
    }

    return openingByProduct;
  }

  /**
   * Hook previo a descontar stock en factura PAID del día: congela apertura si falta.
   */
  async ensureOpeningBeforeSale(
    organizationId: number,
    productIds: number[],
  ): Promise<void> {
    if (productIds.length === 0) return;
    const day = todayCaracas();
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId },
      select: { id: true, name: true, stock: true },
    });
    const liquor = products.filter((p) => classifyLiquorProduct(p.name));
    if (liquor.length === 0) return;

    const existing = await this.prisma.liquorDaySnapshot.findMany({
      where: {
        organizationId,
        day: new Date(`${day}T00:00:00.000Z`),
        productId: { in: liquor.map((p) => p.id) },
      },
      select: { productId: true },
    });
    const have = new Set(existing.map((e) => e.productId));
    const missing = liquor.filter((p) => !have.has(p.id));
    if (missing.length === 0) return;

    await this.prisma.liquorDaySnapshot.createMany({
      data: missing.map((p) => ({
        organizationId,
        day: new Date(`${day}T00:00:00.000Z`),
        productId: p.id,
        openingStock: Math.max(0, p.stock),
      })),
      skipDuplicates: true,
    });
  }

  async getDailyReport(organizationId: number, day?: string) {
    const requestedDay =
      day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : yesterdayCaracas();

    let reportDay = requestedDay;
    let usedFallback = false;
    let rows = await this.loadDayRows(organizationId, reportDay);

    const classifiedProbe = rows.some((r) => classifyLiquorProduct(r.name));
    if (!classifiedProbe) {
      const latest = await this.findLatestLiquorDay(organizationId);
      if (latest && latest !== reportDay) {
        reportDay = latest;
        usedFallback = true;
        rows = await this.loadDayRows(organizationId, reportDay);
      }
    }

    type Line = {
      productId: number;
      sku: string | null;
      name: string;
      quantity: number;
      usd: number;
      bucket: LiquorBucket;
      beerStyle: BeerStyle | null;
      opening: number;
      remainingTheoretical: number;
    };

    const soldMap = new Map<number, { name: string; quantity: number }>();
    for (const item of rows) {
      if (!classifyLiquorProduct(item.name)) continue;
      const prev = soldMap.get(item.productId);
      if (prev) prev.quantity += item.quantity;
      else soldMap.set(item.productId, { name: item.name, quantity: item.quantity });
    }

    const openingByProduct = await this.ensureDaySnapshots(
      organizationId,
      reportDay,
      soldMap,
    );

    // Cargar productos con snapshot aunque no vendieron (aparecen en detalle)
    const snapshotProducts = await this.prisma.product.findMany({
      where: {
        organizationId,
        id: { in: [...openingByProduct.keys()] },
      },
      select: { id: true, sku: true, name: true },
    });
    const productMeta = new Map(
      snapshotProducts.map((p) => [p.id, p] as const),
    );

    const byProduct = new Map<number, Line>();

    const upsertLine = (
      productId: number,
      sku: string | null,
      name: string,
      quantity: number,
      usd: number,
    ) => {
      const bucket = classifyLiquorProduct(name);
      if (!bucket) return;
      const beerStyle =
        bucket === "cerveza_light" || bucket === "cerveza_negra"
          ? classifyBeerStyle(name)
          : null;
      const opening = openingByProduct.get(productId) ?? quantity;
      const prev = byProduct.get(productId);
      if (prev) {
        prev.quantity += quantity;
        prev.usd += usd;
        prev.remainingTheoretical = Math.max(0, prev.opening - prev.quantity);
      } else {
        byProduct.set(productId, {
          productId,
          sku,
          name,
          quantity,
          usd,
          bucket,
          beerStyle,
          opening,
          remainingTheoretical: Math.max(0, opening - quantity),
        });
      }
    };

    for (const item of rows) {
      upsertLine(item.productId, item.sku, item.name, item.quantity, item.usd);
    }

    // Productos con apertura y 0 ventas
    for (const [productId, opening] of openingByProduct) {
      if (byProduct.has(productId)) continue;
      const meta = productMeta.get(productId);
      if (!meta) continue;
      upsertLine(meta.id, meta.sku, meta.name, 0, 0);
      const line = byProduct.get(productId);
      if (line) {
        line.opening = opening;
        line.remainingTheoretical = Math.max(0, opening);
      }
    }

    const lines = [...byProduct.values()].sort(
      (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name),
    );

    const styleMap = new Map<
      BeerStyle,
      {
        bottles: number;
        usd: number;
        opening: number;
        remaining: number;
        products: Line[];
      }
    >();
    for (const line of lines) {
      if (!line.beerStyle) continue;
      const cur = styleMap.get(line.beerStyle) ?? {
        bottles: 0,
        usd: 0,
        opening: 0,
        remaining: 0,
        products: [],
      };
      cur.bottles += line.quantity;
      cur.usd += line.usd;
      cur.opening += line.opening;
      cur.remaining += line.remainingTheoretical;
      cur.products.push(line);
      styleMap.set(line.beerStyle, cur);
    }
    const beerByStyle = BEER_STYLE_ORDER.filter((k) => styleMap.has(k)).map(
      (key) => {
        const cur = styleMap.get(key)!;
        return {
          key,
          label: BEER_STYLE_LABELS[key],
          bottles: cur.bottles,
          usd: Math.round(cur.usd * 100) / 100,
          opening: cur.opening,
          remainingTheoretical: cur.remaining,
          pack: packFromBottles(cur.bottles),
          packOpening: packFromBottles(cur.opening),
          packRemaining: packFromBottles(cur.remaining),
          products: cur.products,
        };
      },
    );

    const emptyPack = packFromBottles(0);
    type BucketBlock = {
      key: LiquorBucket;
      label: string;
      bottles: number;
      usd: number;
      opening: number;
      remainingTheoretical: number;
      pack: ReturnType<typeof packFromBottles>;
      packOpening: ReturnType<typeof packFromBottles>;
      packRemaining: ReturnType<typeof packFromBottles>;
      products: Line[];
    };
    const buckets: Record<LiquorBucket, BucketBlock> = {
      cerveza_light: {
        key: "cerveza_light",
        label: LIQUOR_BUCKET_LABELS.cerveza_light,
        bottles: 0,
        usd: 0,
        opening: 0,
        remainingTheoretical: 0,
        pack: emptyPack,
        packOpening: emptyPack,
        packRemaining: emptyPack,
        products: [],
      },
      cerveza_negra: {
        key: "cerveza_negra",
        label: LIQUOR_BUCKET_LABELS.cerveza_negra,
        bottles: 0,
        usd: 0,
        opening: 0,
        remainingTheoretical: 0,
        pack: emptyPack,
        packOpening: emptyPack,
        packRemaining: emptyPack,
        products: [],
      },
      whisky: {
        key: "whisky",
        label: LIQUOR_BUCKET_LABELS.whisky,
        bottles: 0,
        usd: 0,
        opening: 0,
        remainingTheoretical: 0,
        pack: emptyPack,
        packOpening: emptyPack,
        packRemaining: emptyPack,
        products: [],
      },
      otros_licores: {
        key: "otros_licores",
        label: LIQUOR_BUCKET_LABELS.otros_licores,
        bottles: 0,
        usd: 0,
        opening: 0,
        remainingTheoretical: 0,
        pack: emptyPack,
        packOpening: emptyPack,
        packRemaining: emptyPack,
        products: [],
      },
    };

    for (const line of lines) {
      const b = buckets[line.bucket];
      b.bottles += line.quantity;
      b.usd += line.usd;
      b.opening += line.opening;
      b.remainingTheoretical += line.remainingTheoretical;
      b.products.push(line);
    }

    for (const key of Object.keys(buckets) as LiquorBucket[]) {
      const b = buckets[key];
      b.pack = packFromBottles(b.bottles);
      b.packOpening = packFromBottles(b.opening);
      b.packRemaining = packFromBottles(b.remainingTheoretical);
      b.usd = Math.round(b.usd * 100) / 100;
    }

    const beerBottles =
      buckets.cerveza_light.bottles + buckets.cerveza_negra.bottles;
    const beerOpening =
      buckets.cerveza_light.opening + buckets.cerveza_negra.opening;
    const beerRemaining =
      buckets.cerveza_light.remainingTheoretical +
      buckets.cerveza_negra.remainingTheoretical;
    const beerPack = packFromBottles(beerBottles);

    return {
      day: reportDay,
      requestedDay,
      usedFallback,
      organizationId,
      openingMode: "automatic" as const,
      rules: {
        bottlesPerTobo: BOTTLES_PER_TOBO,
        tobosPerCase: TOBOS_PER_CASE,
        bottlesPerCase: BOTTLES_PER_CASE,
        note: "1 tobo = 12 botellas. 3 tobos = 1 caja de cerveza. Whisky y otros licores van por unidad. Apertura automática al inicio del día.",
      },
      beer: {
        bottles: beerBottles,
        opening: beerOpening,
        remainingTheoretical: beerRemaining,
        ...beerPack,
        packOpening: packFromBottles(beerOpening),
        packRemaining: packFromBottles(beerRemaining),
        light: buckets.cerveza_light,
        negra: buckets.cerveza_negra,
        byStyle: beerByStyle,
      },
      whisky: buckets.whisky,
      otros: buckets.otros_licores,
      products: lines.map((l) => ({
        ...l,
        usd: Math.round(l.usd * 100) / 100,
        pack:
          l.bucket === "cerveza_light" || l.bucket === "cerveza_negra"
            ? packFromBottles(l.quantity)
            : null,
        packOpening:
          l.bucket === "cerveza_light" || l.bucket === "cerveza_negra"
            ? packFromBottles(l.opening)
            : null,
        packRemaining:
          l.bucket === "cerveza_light" || l.bucket === "cerveza_negra"
            ? packFromBottles(l.remainingTheoretical)
            : null,
        bucketLabel: LIQUOR_BUCKET_LABELS[l.bucket],
        beerStyleLabel: l.beerStyle ? BEER_STYLE_LABELS[l.beerStyle] : null,
      })),
    };
  }
}
