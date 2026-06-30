/**
 * Script de configuración de usuarios, roles y membresías para MARFYL
 *
 * Uso:
 *   pnpm tsx prisma/setup-roles-users.ts
 *
 * Este script:
 * 1. Agrega POS_OPERATOR al enum Role (si no existe en la BD)
 * 2. Crea organización de prueba "MARFYL Demo"
 * 3. Crea usuarios con todos los roles (incluyendo POS_OPERATOR)
 * 4. Asigna membresías a la organización con el rol correspondiente
 *
 * Idempotente: puede ejecutarse múltiples veces sin duplicar datos.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

// ─── Configuración ────────────────────────────────────────────────────────────

const ORGANIZATION_NAME = 'MARFYL Demo';
const ORGANIZATION_SLUG = 'marfyl-demo';

interface UserSeed {
  email: string;
  password: string;
  name: string;
  role: Role | 'POS_OPERATOR'; // POS_OPERATOR se agrega al enum vía SQL en runtime
}

const USERS: UserSeed[] = [
  {
    email: 'pos@marfyl.com',
    password: 'pos123',
    name: 'Cajero POS',
    role: 'POS_OPERATOR',
  }
];

// ─── Utilidades ───────────────────────────────────────────────────────────────

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

async function createUser(
  email: string,
  password: string,
  name: string,
): Promise<{ id: number; email: string }> {
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      fullName: name,
      passwordHash,
      isActive: true,
    },
    create: {
      email,
      passwordHash,
      fullName: name,
      isActive: true,
    },
  });

  return { id: user.id, email: user.email };
}

async function createMembership(
  userId: number,
  organizationId: number,
  role: Role | 'POS_OPERATOR',
): Promise<void> {
  await prisma.member.upsert({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
    update: {
      role: role as Role,
      status: 'ACTIVE',
    },
    create: {
      userId,
      organizationId,
      role: role as Role,
      status: 'ACTIVE',
    },
  });
}

// ─── Verificar y agregar POS_OPERATOR al enum Role ────────────────────────────

async function ensurePosOperatorEnum(): Promise<void> {
  console.log('🔍 Verificando si POS_OPERATOR existe en el enum Role...');

  // Consultar los valores actuales del enum en PostgreSQL
  const result = await prisma.$queryRaw<Array<{ enums: string }>>`
    SELECT e.enumlabel AS enums
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Role'
    ORDER BY e.enumsortorder
  `;

  const existingValues = result.map((r) => r.enums);
  console.log(`   Valores actuales: ${existingValues.join(', ')}`);

  if (existingValues.includes('POS_OPERATOR')) {
    console.log('   ✅ POS_OPERATOR ya existe en el enum.\n');
    return;
  }

  console.log('   ⚠️  POS_OPERATOR no existe. Agregando al enum...');

  await prisma.$executeRawUnsafe(
    `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'POS_OPERATOR'`,
  );

  console.log('   ✅ POS_OPERATOR agregado exitosamente al enum.\n');
}

// ─── Función principal ────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Iniciando configuración de usuarios y roles para MARFYL\n');
  console.log('━'.repeat(60));

  // ── Paso 1: Verificar/crear enum POS_OPERATOR ──
  await ensurePosOperatorEnum();

  // ── Paso 2: Crear organización de prueba ──
  console.log('🏢 Creando organización de prueba...');

  const organization = await prisma.organization.upsert({
    where: { slug: ORGANIZATION_SLUG },
    update: {
      nombre: ORGANIZATION_NAME,
      plan: 'FREE',
    },
    create: {
      nombre: ORGANIZATION_NAME,
      slug: ORGANIZATION_SLUG,
      plan: 'FREE',
    },
  });

  console.log(`   ✅ Organización: ${organization.nombre} (ID: ${organization.id}, slug: ${organization.slug})\n`);

  // ── Paso 3: Crear usuarios y asignar membresías ──
  console.log('👤 Creando usuarios y asignando membresías...\n');

  for (const userData of USERS) {
    const user = await createUser(userData.email, userData.password, userData.name);
    await createMembership(user.id, organization.id, userData.role);
    console.log(
      `   ✅ ${userData.name} (${userData.email}) → rol: ${userData.role}`,
    );
  }

  // ── Resumen ──
  console.log('\n' + '━'.repeat(60));
  console.log('\n✅ Configuración completada exitosamente!\n');
  console.log('📋 Credenciales de acceso:');
  console.log('━'.repeat(60));

  for (const u of USERS) {
    console.log(`   ${u.role.padEnd(16)} │ ${u.email.padEnd(30)} │ ${u.password}`);
  }

  console.log('━'.repeat(60));
  console.log(`\n🏢 Organización: ${ORGANIZATION_NAME} (${ORGANIZATION_SLUG})`);
  console.log('🔐 Todos los usuarios están activos y pueden iniciar sesión.');
  console.log('\n💡 Este script es idempotente: puedes ejecutarlo múltiples veces.');
}

main()
  .catch((e) => {
    console.error('\n❌ Error durante la configuración:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
