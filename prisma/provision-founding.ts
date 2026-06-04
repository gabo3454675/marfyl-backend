/**
 * Provisiona grupo fundador en la BD actual (Neon dev):
 * - Rancho, Monddy, Davean: billingExempt + ENTERPRISE
 * - Concierto solo Monddy
 * - Dueños multi-org (sin isSuperAdmin de plataforma)
 *
 * Uso: pnpm provision:founding
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { assertMarfylDatabaseUrl } from '../src/common/database-guard';
import { CONCERT_ORG_SLUG, FOUNDING_ORG_SLUGS } from '../src/common/founding-orgs';

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const prisma = new PrismaClient();

const FOUNDING_ORGS = [
  { nombre: 'El Rancho de Germán', slug: 'el-rancho-de-german', plan: 'ENTERPRISE' as const },
  { nombre: 'Monddy Corp', slug: 'monddy', plan: 'ENTERPRISE' as const },
  { nombre: 'Davean', slug: 'davean', plan: 'ENTERPRISE' as const },
];

const OWNER_USERS = [
  {
    email: process.env.SUPER_ADMIN_EMAIL!,
    fullName: 'Gabriel longa',
    password: process.env.SUPER_ADMIN_PASSWORD!,
    role: 'ADMIN' as Role,
  },
  {
    email: process.env.SUPER_ADMIN_2_EMAIL!,
    fullName: 'Angel Pereira',
    password: process.env.SUPER_ADMIN_2_PASSWORD!,
    role: 'ADMIN' as Role,
  },
];

async function main() {
  for (const owner of OWNER_USERS) {
    if (!owner.password || owner.password.trim() === '') {
      console.error(`❌ SUPER_ADMIN_PASSWORD o SUPER_ADMIN_2_PASSWORD no están configurados en variables de entorno. Provision abortado.`);
      process.exit(1);
    }
    if (owner.password === '338232gG' || owner.password === 'monddy33' || owner.password === 'cambiar-por-clave-segura') {
      console.error(`❌ La contraseña para ${owner.email} es insecure. Usa una contraseña única y segura. Provision abortado.`);
      process.exit(1);
    }
  }

  console.log('🏢 Provisionando organizaciones fundadoras...\n');

  const orgs: { id: number; slug: string; nombre: string }[] = [];

  for (const data of FOUNDING_ORGS) {
    const org = await prisma.organization.upsert({
      where: { slug: data.slug },
      update: {
        nombre: data.nombre,
        plan: data.plan,
        billingExempt: true,
        concertModuleEnabled: data.slug === CONCERT_ORG_SLUG,
      },
      create: {
        nombre: data.nombre,
        slug: data.slug,
        plan: data.plan,
        billingExempt: true,
        concertModuleEnabled: data.slug === CONCERT_ORG_SLUG,
      },
    });
    orgs.push(org);
    console.log(
      `✅ ${org.nombre} (${org.slug}) — billingExempt, concierto=${org.concertModuleEnabled}`,
    );
  }

  console.log('\n👤 Dueños multi-negocio (misma clave, 3 empresas, sin super admin plataforma):\n');

  for (const owner of OWNER_USERS) {
    const passwordHash = await bcrypt.hash(owner.password, 10);
    const existing = await prisma.user.findUnique({ where: { email: owner.email } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            fullName: owner.fullName,
            passwordHash,
            isSuperAdmin: false,
            isActive: true,
          },
        })
      : await prisma.user.create({
          data: {
            email: owner.email,
            fullName: owner.fullName,
            passwordHash,
            isSuperAdmin: false,
            isActive: true,
          },
        });

    for (const org of orgs) {
      await prisma.member.upsert({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: org.id,
          },
        },
        update: { role: owner.role, status: 'ACTIVE' },
        create: {
          userId: user.id,
          organizationId: org.id,
          role: owner.role,
          status: 'ACTIVE',
        },
      });
    }

    console.log(`✅ ${user.email} → ${FOUNDING_ORG_SLUGS.join(', ')} (${owner.role})`);
  }

  console.log('\n✔ Listo. Login con glonga10@gmail.com o agpereir@gmail.com y selector de empresa.');
  console.log('  Concierto / boletería: solo visible en Monddy Corp.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
