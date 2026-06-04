/**
 * Admin general de plataforma MARFYL (isSuperAdmin):
 * - Ve TODAS las empresas en el selector (fundadoras, demo, clientes nuevos)
 * - Puede crear organizaciones desde Configuración
 *
 * Uso: pnpm provision:platform-admin
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

const PLATFORM_ADMIN_EMAIL =
  process.env.PLATFORM_ADMIN_EMAIL || 'admin@marfyl.dev';
const PLATFORM_ADMIN_PASSWORD =
  process.env.PLATFORM_ADMIN_PASSWORD || 'MarfylAdmin2026!';
const PLATFORM_ADMIN_NAME =
  process.env.PLATFORM_ADMIN_NAME || 'Admin MARFYL Plataforma';

async function main() {
  const passwordHash = await bcrypt.hash(PLATFORM_ADMIN_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: PLATFORM_ADMIN_EMAIL },
    update: {
      fullName: PLATFORM_ADMIN_NAME,
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
    },
    create: {
      email: PLATFORM_ADMIN_EMAIL,
      fullName: PLATFORM_ADMIN_NAME,
      passwordHash,
      isSuperAdmin: true,
      isActive: true,
    },
  });

  console.log('✅ Admin general de plataforma listo');
  console.log(`   Email: ${user.email}`);
  console.log(`   isSuperAdmin: ${user.isSuperAdmin}`);
  console.log(`   Contraseña: (la de PLATFORM_ADMIN_PASSWORD o por defecto en script)`);
  console.log('\n   En login verás todas las organizaciones + futuras que crees.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
