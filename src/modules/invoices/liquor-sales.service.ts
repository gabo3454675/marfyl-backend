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

function caracasDayBounds(day: string) {
  // day = YYYY-MM-DD in America/Caracas (UTC-4)
  const start = new Date(`${day}T04:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function yesterdayCaracas(): string {
  const now = new Date();
  const caracas = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  caracas.setUTCDate(caracas.getUTCDate() - 1);
  return caracas.toISOString().slice(0, 10);
}

@Injectable()
export class LiquorSalesService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyReport(organizationId: number, day?: string) {
    const reportDay = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : yesterdayCaracas();
    const { start, end } = caracasDayBounds(reportDay);

    const items = await this.prisma.invoiceItem.findMany({
      where: {
        invoice: {
          organizationId,
          status: "PAID",
          deletedAt: null,
          issueDate: { gte: start, lt: end },
        },
        product: {
          isBundle: false,
          isService: false,
        },
      },
      select: {
        quantity: true,
        subtotal: true,
        product: { select: { id: true, sku: true, name: true } },
      },
    });

    type Line = {
      productId: number;
      sku: string | null;
      name: string;
      quantity: number;
      usd: number;
      bucket: LiquorBucket;
    };

    const byProduct = new Map<number, Line>();
    for (const item of items) {
      const bucket = classifyLiquorProduct(item.product.name);
      if (!bucket) continue;
      const prev = byProduct.get(item.product.id);
      if (prev) {
        prev.quantity += item.quantity;
        prev.usd += Number(item.subtotal);
      } else {
        byProduct.set(item.product.id, {
          productId: item.product.id,
          sku: item.product.sku,
          name: item.product.name,
          quantity: item.quantity,
          usd: Number(item.subtotal),
          bucket,
        });
      }
    }

    const lines = [...byProduct.values()].sort((a, b) => b.quantity - a.quantity);

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
