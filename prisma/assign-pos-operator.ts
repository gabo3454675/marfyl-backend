#!/usr/bin/env ts-node
/**
 * Script interactivo para asignar POS_OPERATOR a organizaciones
 *
 * Uso: pnpm tsx prisma/assign-pos-operator.ts
 *
 * Este script:
 * 1. Lista todas las organizaciones existentes
 * 2. Permite seleccionar interactivamente a cuáles asociar POS_OPERATOR
 * 3. Crea (o reutiliza) el usuario pos@marfyl.com
 * 4. Crea membresías con rol POS_OPERATOR en las organizaciones seleccionadas
 * 5. Muestra un resumen final
 *
 * Idempotente: puede ejecutarse múltiples veces sin duplicar datos.
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as readline from 'readline';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

const POS_OPERATOR_EMAIL = 'pos@marfyl.com';
const POS_OPERATOR_PASSWORD = 'pos123';
const POS_OPERATOR_NAME = 'Cajero POS';

// ─── Función principal ────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Asignando POS_OPERATOR a organizaciones\n');
  console.log('━'.repeat(60));

  // ── Paso 1: Verificar que POS_OPERATOR exista en el enum ──
  console.log('\n🔍 Verificando que POS_OPERATOR exista en el enum Role...');

  const enumResult = await prisma.$queryRaw<Array<{ enums: string }>>`
    SELECT e.enumlabel AS enums
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'Role'
    ORDER BY e.enumsortorder
  `;

  const existingRoles = enumResult.map((r) => r.enums);
  if (!existingRoles.includes('POS_OPERATOR')) {
    console.log('   ⚠️  POS_OPERATOR no existe en el enum. Agregando...');
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'POS_OPERATOR'`,
    );
    console.log('   ✅ POS_OPERATOR agregado al enum.\n');
  } else {
    console.log('   ✅ POS_OPERATOR ya existe en el enum.\n');
  }

  // ── Paso 2: Listar organizaciones ──
  console.log('📋 Organizaciones encontradas:\n');

  const orgs = await prisma.organization.findMany({
    select: { id: true, nombre: true, slug: true },
    orderBy: { nombre: 'asc' },
  });

  if (orgs.length === 0) {
    console.log('❌ No hay organizaciones en la base de datos.');
    console.log('   Crea al menos una organización antes de ejecutar este script.');
    return;
  }

  orgs.forEach((org, index) => {
    console.log(`   ${index + 1}. ${org.nombre} (${org.slug}) [ID: ${org.id}]`);
  });

  // ── Paso 3: Pedir selección interactiva ──
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(
      '\n👉 Ingresa los números separados por coma (o "all" para todas): ',
      resolve,
    );
  });
  rl.close();

  // ── Paso 4: Procesar selección ──
  let selectedIndices: number[];

  if (answer.toLowerCase() === 'all' || answer.trim() === '*') {
    selectedIndices = orgs.map((_, i) => i);
  } else {
    selectedIndices = answer
      .split(',')
      .map((n) => parseInt(n.trim(), 10) - 1);
  }

  // Validar selección
  const validIndices = selectedIndices.filter(
    (i) => !isNaN(i) && i >= 0 && i < orgs.length,
  );

  if (validIndices.length === 0) {
    console.log('\n❌ Selección no válida. No se seleccionaron organizaciones.');
    return;
  }

  // Eliminar duplicados
  const uniqueIndices = [...new Set(validIndices)];
  const selectedOrgs = uniqueIndices.map((i) => orgs[i]);

  console.log(`\n✅ Seleccionaste ${selectedOrgs.length} organizaciones:`);
  selectedOrgs.forEach((org) =>
    console.log(`   • ${org.nombre} (${org.slug})`),
  );

  // ── Paso 5: Crear/buscar usuario POS_OPERATOR ──
  console.log('\n📝 Verificando usuario POS_OPERATOR...');

  const passwordHash = await bcrypt.hash(POS_OPERATOR_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: POS_OPERATOR_EMAIL },
    update: {
      fullName: POS_OPERATOR_NAME,
      passwordHash,
      isActive: true,
    },
    create: {
      email: POS_OPERATOR_EMAIL,
      passwordHash,
      fullName: POS_OPERATOR_NAME,
      isActive: true,
    },
  });

  console.log(
    `   ✅ Usuario: ${user.email} (ID: ${user.id}, nombre: ${user.fullName})`,
  );

  // ── Paso 6: Asociar a organizaciones ──
  console.log('\n🔗 Asociando a organizaciones...\n');

  let membershipsCreated = 0;
  let membershipsSkipped = 0;
  let membershipsFailed = 0;

  for (const org of selectedOrgs) {
    try {
      const membership = await prisma.member.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: org.id,
          },
        },
        update: {
          role: 'POS_OPERATOR' as Role,
          status: 'ACTIVE',
        },
        create: {
          userId: user.id,
          organizationId: org.id,
          role: 'POS_OPERATOR' as Role,
          status: 'ACTIVE',
        },
      });

      // Si joinedAt es de hace menos de 5 segundos, es una membresía nueva
      const now = new Date();
      const fiveSecondsAgo = new Date(now.getTime() - 5000);
      const isNew = membership.joinedAt > fiveSecondsAgo;

      if (isNew) {
        console.log(
          `   ✅ ${org.nombre} - Membresía CREADA (ID: ${membership.id})`,
        );
        membershipsCreated++;
      } else {
        console.log(
          `   ⏭️  ${org.nombre} - Ya existía (ID: ${membership.id})`,
        );
        membershipsSkipped++;
      }
    } catch (error) {
      console.log(`   ❌ ${org.nombre} - Error: ${error}`);
      membershipsFailed++;
    }
  }

  // ── Resumen ──
  console.log('\n' + '━'.repeat(60));
  console.log('📊 RESUMEN');
  console.log('━'.repeat(60));
  console.log(`   • Usuario: ${user.email}`);
  console.log(`   • Nombre: ${user.fullName}`);
  console.log(`   • Rol: POS_OPERATOR`);
  console.log(`   • Contraseña: ${POS_OPERATOR_PASSWORD}`);
  console.log(`   • Organizaciones seleccionadas: ${selectedOrgs.length}`);
  console.log(`   • Membresías creadas: ${membershipsCreated}`);
  console.log(`   • Membresías existentes (omitidas): ${membershipsSkipped}`);
  if (membershipsFailed > 0) {
    console.log(`   • Membresías con error: ${membershipsFailed}`);
  }
  console.log('━'.repeat(60));
  console.log('\n🎉 ¡Listo! El usuario POS_OPERATOR está configurado.\n');
  console.log(
    '💡 Este script es idempotente: puedes ejecutarlo múltiples veces.',
  );
}

main()
  .catch((error) => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
