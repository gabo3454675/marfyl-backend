/**
 * Crea una variante "UNIDAD" por defecto para cada producto activo sin variantes.
 *
 * Uso:
 *   npx ts-node prisma/seed-product-variants.ts
 *   pnpm seed:variants
 */
import { PrismaClient } from '@prisma/client';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Buscando productos activos con salePrice > 0...');

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      salePrice: { gt: 0 },
    },
    select: {
      id: true,
      name: true,
      sku: true,
      salePrice: true,
      _count: {
        select: { variants: true },
      },
    },
  });

  console.log(`   Productos activos con precio: ${products.length}`);

  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const product of products) {
    if (product._count.variants > 0) {
      skipped++;
      continue;
    }

    try {
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: 'UNIDAD',
          salePrice: product.salePrice,
          unitQuantity: 1,
          stockBehavior: 'DEDUCT',
          inheritCost: true,
          isDefault: true,
          sortOrder: 0,
          isActive: true,
        },
      });
      created++;
    } catch (err) {
      console.error(`   ❌ Error creando variante para producto #${product.id} (${product.name}):`, err);
      errors++;
    }
  }

  console.log(`\n✅ Procesados: ${products.length}`);
  console.log(`   ✅ Variantes creadas: ${created}`);
  console.log(`   ⏭️  Productos ya con variantes: ${skipped}`);
  if (errors > 0) {
    console.log(`   ❌ Errores: ${errors}`);
  }
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
