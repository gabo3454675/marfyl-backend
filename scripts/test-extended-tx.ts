import { PrismaClient } from "@prisma/client";
import { tenantIsolationExtension } from "../src/common/prisma/tenant-isolation.extension";

async function main() {
  const base = new PrismaClient();
  const prisma = base.$extends(tenantIsolationExtension);

  const data = {
    name: "HELADO BARQUILLA",
    description: "HELADO",
    salePrice: 1.3,
    costPrice: 0.8,
    stock: 3,
    isExempt: true,
  };

  try {
    const r1 = await prisma.product.updateMany({
      where: { organizationId: 2, sku: "00000052" },
      data,
    });
    console.log("extended direct OK", r1);
  } catch (e: any) {
    console.log("extended direct FAIL", e.message);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const r2 = await tx.product.updateMany({
        where: { organizationId: 2, sku: "00000052" },
        data,
      });
      console.log("extended tx OK", r2);
    });
  } catch (e: any) {
    console.log("extended tx FAIL", e.message);
  }

  await base.$disconnect();
}

main();
