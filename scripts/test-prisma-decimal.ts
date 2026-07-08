import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tests = [
    { label: "number", data: { costPrice: 0.8, salePrice: 1.3, stock: 3, isExempt: true, name: "HELADO BARQUILLA", description: "HELADO" } },
    { label: "decimal", data: { costPrice: new Prisma.Decimal("0.8"), salePrice: new Prisma.Decimal("1.3"), stock: 3, isExempt: true, name: "HELADO BARQUILLA", description: "HELADO" } },
    { label: "string", data: { costPrice: "0.8", salePrice: "1.3", stock: 3, isExempt: true, name: "HELADO BARQUILLA", description: "HELADO" } },
  ];

  for (const t of tests) {
    try {
      const r = await prisma.product.updateMany({
        where: { organizationId: 2, sku: "00000052" },
        data: t.data as any,
      });
      console.log(t.label, "OK", r);
    } catch (e: any) {
      console.log(t.label, "FAIL", e.message.split("\n")[0]);
    }
  }
}

main().finally(() => prisma.$disconnect());
