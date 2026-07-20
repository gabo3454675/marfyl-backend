import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  BOTTLES_PER_CASE,
  BOTTLES_PER_TOBO,
  LIQUOR_BUCKET_LABELS,
  TOBOS_PER_CASE,
  classifyLiquorProduct,
  packFromBottles,
  type LiquorBucket,
} from "./liquor-sales.util";

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

  async getDailyReport(organizationId: number, day?: string) {
    const requestedDay =
      day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : yesterdayCaracas();

    let reportDay = requestedDay;
    let usedFallback = false;
    let rows = await this.loadDayRows(organizationId, reportDay);

    // Si el día pedido no tiene ítems clasificables, caer al último día con licores.
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
    };

    const byProduct = new Map<number, Line>();
    for (const item of rows) {
      const bucket = classifyLiquorProduct(item.name);
      if (!bucket) continue;
      const prev = byProduct.get(item.productId);
      if (prev) {
        prev.quantity += item.quantity;
        prev.usd += item.usd;
      } else {
        byProduct.set(item.productId, {
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          usd: item.usd,
          bucket,
        });
      }
    }

    const lines = [...byProduct.values()].sort(
      (a, b) => b.quantity - a.quantity,
    );

    const emptyPack = packFromBottles(0);
    const buckets: Record<
      LiquorBucket,
      {
        key: LiquorBucket;
        label: string;
        bottles: number;
        usd: number;
        pack: ReturnType<typeof packFromBottles>;
        products: Line[];
      }
    > = {
      cerveza_light: {
        key: "cerveza_light",
        label: LIQUOR_BUCKET_LABELS.cerveza_light,
        bottles: 0,
        usd: 0,
        pack: emptyPack,
        products: [],
      },
      cerveza_negra: {
        key: "cerveza_negra",
        label: LIQUOR_BUCKET_LABELS.cerveza_negra,
        bottles: 0,
        usd: 0,
        pack: emptyPack,
        products: [],
      },
      whisky: {
        key: "whisky",
        label: LIQUOR_BUCKET_LABELS.whisky,
        bottles: 0,
        usd: 0,
        pack: emptyPack,
        products: [],
      },
      otros_licores: {
        key: "otros_licores",
        label: LIQUOR_BUCKET_LABELS.otros_licores,
        bottles: 0,
        usd: 0,
        pack: emptyPack,
        products: [],
      },
    };

    for (const line of lines) {
      const b = buckets[line.bucket];
      b.bottles += line.quantity;
      b.usd += line.usd;
      b.products.push(line);
    }

    for (const key of Object.keys(buckets) as LiquorBucket[]) {
      buckets[key].pack = packFromBottles(buckets[key].bottles);
      buckets[key].usd = Math.round(buckets[key].usd * 100) / 100;
    }

    const beerBottles =
      buckets.cerveza_light.bottles + buckets.cerveza_negra.bottles;
    const beerPack = packFromBottles(beerBottles);

    return {
      day: reportDay,
      requestedDay,
      usedFallback,
      organizationId,
      rules: {
        bottlesPerTobo: BOTTLES_PER_TOBO,
        tobosPerCase: TOBOS_PER_CASE,
        bottlesPerCase: BOTTLES_PER_CASE,
        note: "1 tobo = 12 botellas. 3 tobos = 1 caja de cerveza. Whisky y otros licores van por unidad.",
      },
      beer: {
        bottles: beerBottles,
        ...beerPack,
        light: buckets.cerveza_light,
        negra: buckets.cerveza_negra,
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
        bucketLabel: LIQUOR_BUCKET_LABELS[l.bucket],
      })),
    };
  }
}
