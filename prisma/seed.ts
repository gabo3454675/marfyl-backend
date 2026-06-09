import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

// ============================================
// CONFIGURACIÓN PARA PRODUCCIÓN
// ============================================
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'glonga10@gmail.com';
const SUPER_ADMIN_NAME = 'Gabriel longa';
const SUPER_ADMIN_PASSWORD = '338232gG';

// Segundo Super Admin - Dueño de las 3 empresas
const SUPER_ADMIN_2_EMAIL = 'agpereir@gmail.com';
const SUPER_ADMIN_2_PASSWORD = 'monddy33';
const SUPER_ADMIN_2_NAME = 'Angel Pereira';

// Tercer Super Admin - Plataforma + 3 empresas fundadoras
const SUPER_ADMIN_3_EMAIL = 'josealeonr@gmail.com';
const SUPER_ADMIN_3_PASSWORD = 'JoseMarfyl2026!';
const SUPER_ADMIN_3_NAME = 'Jose Antonio Leon';

async function main() {
  console.log('🌱 Iniciando seed de base de datos para producción...');
  console.log(`📧 Email Super Admin: ${SUPER_ADMIN_EMAIL}`);


  // Hash de contraseña para el Super Admin
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);

  // ============================================
  // 1. CREAR O ACTUALIZAR USUARIO SUPER_ADMIN
  // ============================================
  const superAdminUser = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: {
      isSuperAdmin: true,
      passwordHash,
      fullName: SUPER_ADMIN_NAME,
      isActive: true,
    },
    create: {
      email: SUPER_ADMIN_EMAIL,
      passwordHash,
      fullName: SUPER_ADMIN_NAME,
      isSuperAdmin: true,
      isActive: true,
    },
  });

  console.log('✅ Usuario Super Admin creado/actualizado:', superAdminUser.email);
  console.log(`   ID: ${superAdminUser.id}`);
  console.log(`   isSuperAdmin: ${superAdminUser.isSuperAdmin}`);

  // ============================================
  // 1.2. CREAR O ACTUALIZAR SEGUNDO USUARIO SUPER_ADMIN (Angel Pereira)
  // ============================================
  const passwordHash2 = await bcrypt.hash(SUPER_ADMIN_2_PASSWORD, 10);
  
  const superAdminUser2 = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_2_EMAIL },
    update: {
      isSuperAdmin: true,
      passwordHash: passwordHash2,
      fullName: SUPER_ADMIN_2_NAME,
      isActive: true,
    },
    create: {
      email: SUPER_ADMIN_2_EMAIL,
      passwordHash: passwordHash2,
      fullName: SUPER_ADMIN_2_NAME,
      isSuperAdmin: true,
      isActive: true,
    },
  });

  console.log('✅ Usuario Super Admin 2 creado/actualizado:', superAdminUser2.email);
  console.log(`   ID: ${superAdminUser2.id}`);
  console.log(`   Nombre: ${superAdminUser2.fullName}`);
  console.log(`   isSuperAdmin: ${superAdminUser2.isSuperAdmin}`);

  // ============================================
  // 1.3. CREAR O ACTUALIZAR TERCER SUPER_ADMIN (Jose Antonio Leon)
  // ============================================
  const passwordHash3 = await bcrypt.hash(SUPER_ADMIN_3_PASSWORD, 10);

  const superAdminUser3 = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_3_EMAIL },
    update: {
      isSuperAdmin: true,
      passwordHash: passwordHash3,
      fullName: SUPER_ADMIN_3_NAME,
      isActive: true,
    },
    create: {
      email: SUPER_ADMIN_3_EMAIL,
      passwordHash: passwordHash3,
      fullName: SUPER_ADMIN_3_NAME,
      isSuperAdmin: true,
      isActive: true,
    },
  });

  console.log('✅ Usuario Super Admin 3 creado/actualizado:', superAdminUser3.email);
  console.log(`   ID: ${superAdminUser3.id}`);
  console.log(`   Nombre: ${superAdminUser3.fullName}`);
  console.log(`   isSuperAdmin: ${superAdminUser3.isSuperAdmin}`);

  // ============================================
  // 2. CREAR LAS 3 ORGANIZACIONES
  // ============================================
  const organizationsData = [
    {
      nombre: 'El Rancho de Germán',
      slug: 'el-rancho-de-german',
      plan: 'ENTERPRISE' as const,
      billingExempt: true,
      concertModuleEnabled: false,
    },
    {
      nombre: 'Monddy Corp',
      slug: 'monddy',
      plan: 'ENTERPRISE' as const,
      billingExempt: true,
      concertModuleEnabled: true,
    },
    {
      nombre: 'Davean',
      slug: 'davean',
      plan: 'ENTERPRISE' as const,
      billingExempt: true,
      concertModuleEnabled: false,
    },
  ];

  const organizations: Array<{
    id: number;
    nombre: string;
    slug: string;
    plan: string;
    createdAt: Date;
    updatedAt: Date;
  }> = [];

  for (const orgData of organizationsData) {
    // Usar upsert basado en slug (único)
    const organization = await prisma.organization.upsert({
      where: { slug: orgData.slug },
      update: {
        nombre: orgData.nombre,
        plan: orgData.plan,
        billingExempt: orgData.billingExempt,
        concertModuleEnabled: orgData.concertModuleEnabled,
      },
      create: {
        nombre: orgData.nombre,
        slug: orgData.slug,
        plan: orgData.plan,
        billingExempt: orgData.billingExempt,
        concertModuleEnabled: orgData.concertModuleEnabled,
      },
    });

    organizations.push(organization);
    console.log(
      `✅ Organización creada/actualizada: ${organization.nombre} (${organization.slug}) - Plan: ${organization.plan}`,
    );
  }

  // ============================================
  // 3. ASOCIAR SUPER_ADMINS A TODAS LAS ORGANIZACIONES
  // Los SUPER_ADMIN necesitan acceso a todas para gestionarlas
  // ============================================
  const superAdmins = [superAdminUser, superAdminUser2, superAdminUser3];
  
  for (const organization of organizations) {
    for (const admin of superAdmins) {
      await prisma.member.upsert({
        where: {
          userId_organizationId: {
            userId: admin.id,
            organizationId: organization.id,
          },
        },
        update: {
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
        create: {
          userId: admin.id,
          organizationId: organization.id,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
        },
      });

      console.log(
        `✅ Membresía creada: ${admin.fullName || admin.email} → ${organization.nombre} (rol: SUPER_ADMIN)`,
      );
    }
  }

  // ============================================
  // 4. CREAR CATEGORÍAS DE GASTOS POR DEFECTO
  // ============================================
  const defaultCategories = [
    { name: 'Inventario', description: 'Compras de productos para inventario' },
    { name: 'Servicios', description: 'Servicios profesionales y técnicos' },
    { name: 'Nómina', description: 'Pagos de salarios y beneficios' },
    { name: 'Mantenimiento', description: 'Mantenimiento de equipos e instalaciones' },
    { name: 'Alquiler', description: 'Alquiler de locales y espacios' },
    { name: 'Utilidades', description: 'Servicios públicos (luz, agua, internet)' },
    { name: 'Marketing', description: 'Publicidad y promoción' },
    { name: 'Otros', description: 'Otros gastos operativos' },
  ];

  // Crear categorías para cada organización
  for (const organization of organizations) {
    // Necesitamos una Company para las categorías (legacy requirement)
    // Buscar o crear una company legacy para cada organización
    let company = await prisma.company.findFirst({
      where: { name: organization.nombre },
    });

    if (!company) {
      company = await prisma.company.create({
        data: {
          name: organization.nombre,
          taxId: `J-${Math.floor(Math.random() * 100000000)}-${Math.floor(Math.random() * 10)}`,
          currency: 'USD',
          address: 'Venezuela',
          isActive: true,
        },
      });
      console.log(`✅ Empresa legacy creada: ${company.name}`);
    }

    // Crear categorías de gastos (idempotente)
    for (const catData of defaultCategories) {
      const existing = await prisma.expenseCategory.findFirst({
        where: {
          organizationId: organization.id,
          name: catData.name,
        },
      });

      if (!existing) {
        await prisma.expenseCategory.create({
          data: {
            companyId: company.id,
            organizationId: organization.id,
            name: catData.name,
            description: catData.description,
          },
        });
      }
    }

    console.log(`✅ Categorías de gastos verificadas para ${organization.nombre}`);
  }

  // ============================================
  // RESUMEN FINAL
  // ============================================
  console.log('\n🎉 Seed completado exitosamente!');
  console.log('\n📋 Credenciales de acceso - Super Administradores:');
  console.log('\n   1. Gabriel:');
  console.log(`      Email: ${SUPER_ADMIN_EMAIL}`);
  console.log(`      Password: ${SUPER_ADMIN_PASSWORD}`);
  console.log('\n   2. Angel Pereira:');
  console.log(`      Email: ${SUPER_ADMIN_2_EMAIL}`);
  console.log(`      Password: ${SUPER_ADMIN_2_PASSWORD}`);
  console.log('\n   3. Jose Antonio Leon:');
  console.log(`      Email: ${SUPER_ADMIN_3_EMAIL}`);
  console.log(`      Password: ${SUPER_ADMIN_3_PASSWORD}`);
  console.log('\n🏢 Organizaciones creadas:');
  organizations.forEach((org) => {
    console.log(`   - ${org.nombre} (${org.slug}) - Plan: ${org.plan}`);
  });
  console.log('\n👤 Los Super Admins están asociados a las 3 organizaciones con rol SUPER_ADMIN.');
  console.log('   Pueden gestionar todas las organizaciones y asignar admins a las que deseen.');
  console.log('\n💡 Este seed es idempotente: puedes ejecutarlo múltiples veces sin duplicar datos.');
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
