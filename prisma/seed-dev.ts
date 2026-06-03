import { PrismaClient, Role, Plan, InvoiceStatus, PaymentStatus, PaymentLineMethod, PaymentLineCurrency, TaskStatus, TaskPriority, MovementType, ConsumptionReason, CreditStatus, CreditTransactionType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPER_ADMIN_EMAIL = 'admin@marfyl.dev';
const SUPER_ADMIN_PASSWORD = 'admin123';

const ORGANIZATIONS = [
  { nombre: 'Marfyl Demo', slug: 'marfyl-demo', plan: Plan.PREMIUM, currency: 'USD', symbol: '$' },
  { nombre: 'El Rancho de Germán', slug: 'el-rancho-de-german', plan: Plan.ENTERPRISE, currency: 'USD', symbol: '$' },
  { nombre: 'Monddy Corp', slug: 'monddy', plan: Plan.ENTERPRISE, currency: 'USD', symbol: '$' },
];

const ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'SELLER', 'WAREHOUSE', 'FISCAL'];

const PRODUCT_TEMPLATES = [
  { name: 'Polar IPA', sku: 'CER-001', category: 'Cervezas', cost: 1.2, price: 2.5, exempt: false },
  { name: 'Polar Pilsen', sku: 'CER-002', category: 'Cervezas', cost: 0.9, price: 2.0, exempt: false },
  { name: 'Regional Light', sku: 'CER-003', category: 'Cervezas', cost: 1.0, price: 2.2, exempt: false },
  { name: 'Corona Extra', sku: 'CER-004', category: 'Cervezas', cost: 1.5, price: 3.0, exempt: false },
  { name: 'Heineken', sku: 'CER-005', category: 'Cervezas', cost: 1.8, price: 3.5, exempt: false },
  { name: 'Santa Teresa 1796', sku: 'LIC-001', category: 'Licores', cost: 25.0, price: 45.0, exempt: false },
  { name: 'Diplomático Reserva', sku: 'LIC-002', category: 'Licores', cost: 35.0, price: 60.0, exempt: false },
  { name: 'Bacardí Carta Blanca', sku: 'LIC-003', category: 'Licores', cost: 12.0, price: 22.0, exempt: false },
  { name: 'Absolut Vodka', sku: 'LIC-004', category: 'Licores', cost: 15.0, price: 28.0, exempt: false },
  { name: 'Jameson Irish Whiskey', sku: 'LIC-005', category: 'Licores', cost: 18.0, price: 32.0, exempt: false },
  { name: 'Agua Mineral 500ml', sku: 'BEB-001', category: 'Bebidas', cost: 0.3, price: 1.0, exempt: true },
  { name: 'Coca-Cola 355ml', sku: 'BEB-002', category: 'Bebidas', cost: 0.5, price: 1.5, exempt: false },
  { name: 'Pepsi 355ml', sku: 'BEB-003', category: 'Bebidas', cost: 0.5, price: 1.5, exempt: false },
  { name: 'Sprite 355ml', sku: 'BEB-004', category: 'Bebidas', cost: 0.5, price: 1.5, exempt: false },
  { name: 'Papelón con Limón', sku: 'BEB-005', category: 'Bebidas', cost: 0.4, price: 1.2, exempt: true },
  { name: 'Tequeños (x6)', sku: 'COM-001', category: 'Comidas', cost: 2.0, price: 5.0, exempt: false },
  { name: 'Cachapa de Queso', sku: 'COM-002', category: 'Comidas', cost: 2.5, price: 6.0, exempt: false },
  { name: 'Arepa Reina Pepiada', sku: 'COM-003', category: 'Comidas', cost: 2.0, price: 5.5, exempt: false },
  { name: 'Pabellón Criollo', sku: 'COM-004', category: 'Comidas', cost: 4.0, price: 9.0, exempt: false },
  { name: 'Parrilla Mixta', sku: 'COM-005', category: 'Comidas', cost: 6.0, price: 14.0, exempt: false },
  { name: 'Cigarrillos Marlboro', sku: 'TAB-001', category: 'Tabaco', cost: 3.0, price: 5.0, exempt: false },
  { name: 'Chucherías Mixtas', sku: 'SNK-001', category: 'Snacks', cost: 0.5, price: 1.0, exempt: true },
];

const COMPANIES_VENEZUELA = [
  'Distribuidora Polar C.A.', 'Corporación Bimbo S.A.', 'Empresas Polar',
  'Grupo Zuliano', 'Comercializadora Tía', 'Makro Comercializadora',
  'Distribuidora de Alimentos', 'Cervecería Regional', 'Ron Santa Teresa',
];

function randomInt(min: number, max: number) { return faker.number.int({ min, max }); }
function pick<T>(arr: T[]): T { return arr[randomInt(0, arr.length - 1)]; }
function weightedPick<T>(arr: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < arr.length; i++) {
    r -= weights[i];
    if (r <= 0) return arr[i];
  }
  return arr[arr.length - 1];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function seed() {
  const passwordHash = await bcrypt.hash(SUPER_ADMIN_PASSWORD, 10);

  // ── 1. Super Admin ──────────────────────────────────────────────────────────
  const superAdmin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: { isSuperAdmin: true, passwordHash },
    create: { email: SUPER_ADMIN_EMAIL, passwordHash, fullName: 'Admin Marfyl', isSuperAdmin: true },
  });
  console.log(`✅ Super Admin: ${superAdmin.email}`);

  // ── 2. Additional employees (10 users per org) ─────────────────────────────
  const allUsers: { user: typeof superAdmin; role: Role }[] = [{ user: superAdmin, role: 'SUPER_ADMIN' }];

  for (let i = 0; i < 10; i++) {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const email = faker.internet.email({ firstName, lastName }).toLowerCase();
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        fullName: `${firstName} ${lastName}`,
        isActive: true,
      },
    });
    const role = weightedPick(ROLES, [5, 20, 20, 30, 15, 10]);
    allUsers.push({ user, role });
  }

  // ── 3. Orgs, legacy Companies & Members ─────────────────────────────────────
  interface OrgCtx {
    org: { id: number; nombre: string; slug: string; plan: string };
    company: { id: number; name: string; taxId: string };
    users: { userId: number; role: Role; fullName: string }[];
  }
  const orgs: OrgCtx[] = [];

  for (const od of ORGANIZATIONS) {
    const org = await prisma.organization.upsert({
      where: { slug: od.slug },
      update: { nombre: od.nombre, plan: od.plan, currencyCode: od.currency, currencySymbol: od.symbol },
      create: { nombre: od.nombre, slug: od.slug, plan: od.plan, currencyCode: od.currency, currencySymbol: od.symbol },
    });

    // Legacy company (required by many models)
    const company = await prisma.company.upsert({
      where: { id: org.id },
      update: { name: od.nombre },
      create: {
        name: od.nombre,
        taxId: `J-${randomInt(10000000, 99999999)}-${randomInt(0, 9)}`,
        currency: od.currency,
        address: faker.location.streetAddress(),
        isActive: true,
      },
    });

    // Assign users to org with random roles
    const memberships: { userId: number; role: Role; fullName: string }[] = [];
    for (const { user, role } of allUsers) {
      const r = user.id === superAdmin.id ? 'SUPER_ADMIN' : role;
      await prisma.member.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
        update: { role: r, status: 'ACTIVE' },
        create: { userId: user.id, organizationId: org.id, role: r, status: 'ACTIVE' },
      });
      memberships.push({ userId: user.id, role: r, fullName: user.fullName ?? user.email });
    }

    orgs.push({ org, company, users: memberships });
    console.log(`✅ Org: ${org.nombre} (${org.slug}) — ${memberships.length} miembros`);
  }

  // ── 4. Expense Categories ──────────────────────────────────────────────────
  const CATEGORIES = [
    'Inventario', 'Servicios', 'Nómina', 'Mantenimiento', 'Alquiler',
    'Utilidades', 'Marketing', 'Transporte', 'Seguros', 'Otros',
  ];
  for (const oc of orgs) {
    for (const cat of CATEGORIES) {
      const existing = await prisma.expenseCategory.findFirst({
        where: { organizationId: oc.org.id, name: cat },
      });
      if (!existing) {
        await prisma.expenseCategory.create({
          data: { companyId: oc.company.id, organizationId: oc.org.id, name: cat },
        });
      }
    }
  }

  // ── 5. Products (20 products per org) ──────────────────────────────────────
  for (const oc of orgs) {
    for (const tpl of PRODUCT_TEMPLATES) {
      const stock = randomInt(10, 200);
      await prisma.product.upsert({
        where: { organizationId_sku: { organizationId: oc.org.id, sku: tpl.sku } },
        update: {
          name: tpl.name,
          costPrice: tpl.cost,
          salePrice: tpl.price,
          stock,
          minStock: randomInt(3, 15),
        },
        create: {
          companyId: oc.company.id,
          organizationId: oc.org.id,
          name: tpl.name,
          sku: tpl.sku,
          barcode: faker.string.numeric(13),
          costPrice: tpl.cost,
          salePrice: tpl.price,
          salePriceCurrency: 'USD',
          stock,
          minStock: randomInt(3, 15),
          isExempt: tpl.exempt,
          isActive: true,
          description: `${tpl.category} — ${tpl.name}`,
        },
      });
    }
    console.log(`✅ ${PRODUCT_TEMPLATES.length} productos — ${oc.org.nombre}`);
  }

  // ── 6. Customers (15 per org) ──────────────────────────────────────────────
  const createdCustomers: { id: number; organizationId: number; companyId: number }[] = [];
  for (const oc of orgs) {
    for (let i = 0; i < 15; i++) {
      const name = faker.person.fullName();
      const c = await prisma.customer.create({
        data: {
          companyId: oc.company.id,
          organizationId: oc.org.id,
          name,
          taxId: randomInt(0, 1) ? `V-${randomInt(10000000, 29999999)}` : `J-${randomInt(30000000, 49999999)}`,
          email: faker.internet.email({ firstName: name.split(' ')[0] }).toLowerCase(),
          phone: `+58${randomInt(412, 428)}${faker.string.numeric(7)}`,
          address: faker.location.streetAddress(),
        },
      });
      createdCustomers.push({ id: c.id, organizationId: oc.org.id, companyId: oc.company.id });
    }
    console.log(`✅ 15 clientes — ${oc.org.nombre}`);
  }

  // ── 7. Suppliers (5 per org) ────────────────────────────────────────────────
  const createdSuppliers: { id: number; organizationId: number; companyId: number }[] = [];
  for (const oc of orgs) {
    for (const supName of COMPANIES_VENEZUELA.slice(0, 5)) {
      const s = await prisma.supplier.create({
        data: {
          companyId: oc.company.id,
          organizationId: oc.org.id,
          name: supName,
          taxId: `J-${randomInt(50000000, 99999999)}-${randomInt(0, 9)}`,
          email: faker.internet.email({ firstName: supName.split(' ')[0] }).toLowerCase(),
          phone: `+58${randomInt(212, 281)}${faker.string.numeric(7)}`,
          address: faker.location.streetAddress(),
        },
      });
      createdSuppliers.push({ id: s.id, organizationId: oc.org.id, companyId: oc.company.id });
    }
    console.log(`✅ 5 proveedores — ${oc.org.nombre}`);
  }

  // ── 8. Invoices with items & payments (30 per org) ──────────────────────────
  for (const oc of orgs) {
    const orgProducts = await prisma.product.findMany({ where: { organizationId: oc.org.id, isActive: true } });
    const orgCustomers = createdCustomers.filter(c => c.organizationId === oc.org.id);
    const orgUsers = oc.users;
    const orgCategories = await prisma.expenseCategory.findMany({ where: { organizationId: oc.org.id } });

    let consecutive = 1;
    for (let i = 0; i < 30; i++) {
      const customer = pick(orgCustomers);
      const seller = pick(orgUsers);
      const itemCount = randomInt(1, 5);
      const itemsData = Array.from({ length: itemCount }, () => {
        const product = pick(orgProducts);
        const qty = randomInt(1, 6);
        const unitPrice = Number(product.salePrice);
        const subtotal = qty * unitPrice;
        const taxRate = product.isExempt ? 0 : 16;
        const taxableBase = product.isExempt ? 0 : subtotal;
        const ivaLine = product.isExempt ? 0 : +(subtotal * 0.16).toFixed(2);
        return { productId: product.id, qty, unitPrice, subtotal, taxRate, taxableBase, ivaLine };
      });

      const totalAmount = itemsData.reduce((s, it) => s + it.subtotal, 0);
      const ivaTotal = itemsData.reduce((s, it) => s + it.ivaLine, 0);
      const baseGeneral = itemsData.reduce((s, it) => s + it.taxableBase, 0);
      const today = new Date();
      const daysAgo = randomInt(1, 60);
      const issueDate = new Date(today.getTime() - daysAgo * 86400000);
      const status: InvoiceStatus = weightedPick(['PAID', 'PENDING', 'CANCELLED'] as InvoiceStatus[], [60, 25, 15]);
      const paymentStatus: PaymentStatus = status === 'PAID' ? 'paid' : status === 'PENDING' ? 'pending_credit' : 'paid';
      const montoUsd = status === 'PAID' ? totalAmount : 0;
      const montoBs = status === 'PAID' ? +(totalAmount * randomInt(45, 55)).toFixed(2) : null;

      const invoice = await prisma.invoice.create({
        data: {
          companyId: oc.company.id,
          organizationId: oc.org.id,
          customerId: customer.id,
          sellerId: seller.userId,
          totalAmount,
          status,
          paymentStatus,
          paymentMethod: status === 'PAID' ? pick(['CASH', 'ZELLE', 'CARD', 'PAGO_MOVIL']) : 'CREDIT',
          montoUsd,
          montoBs,
          tasaReferencia: montoBs ? +(montoBs / montoUsd).toFixed(2) : null,
          baseGeneral,
          ivaAmount: ivaTotal,
          issueDate,
          consecutiveNumber: consecutive++,
          notes: faker.lorem.sentence(),
          items: {
            create: itemsData.map(it => ({
              productId: it.productId,
              quantity: it.qty,
              unitPrice: it.unitPrice,
              subtotal: it.subtotal,
              taxRate: it.taxRate,
              taxableBase: it.taxableBase,
              ivaLine: it.ivaLine,
            })),
          },
        },
      });

      // Payment lines for paid invoices
      if (status === 'PAID' && montoUsd > 0) {
        const method = pick([PaymentLineMethod.CASH_USD, PaymentLineMethod.CASH_BS, PaymentLineMethod.ZELLE, PaymentLineMethod.CARD, PaymentLineMethod.PAGO_MOVIL]);
        const cur: PaymentLineCurrency = method === PaymentLineMethod.CASH_BS || method === PaymentLineMethod.PAGO_MOVIL ? PaymentLineCurrency.VES : PaymentLineCurrency.USD;
        await prisma.invoicePaymentLine.create({
          data: { invoiceId: invoice.id, method, amount: method === PaymentLineMethod.CASH_BS || method === PaymentLineMethod.PAGO_MOVIL ? (montoBs ?? totalAmount) : totalAmount, currency: cur },
        });
        const isBs = method === PaymentLineMethod.CASH_BS || method === PaymentLineMethod.PAGO_MOVIL;
        await prisma.pago.create({
          data: {
            facturaId: invoice.id,
            moneda: isBs ? 'VES' : 'USD',
            metodo: method === PaymentLineMethod.CASH_USD || method === PaymentLineMethod.CASH_BS ? 'EFECTIVO' : method === PaymentLineMethod.PAGO_MOVIL ? 'PAGO_MOVIL' : method === PaymentLineMethod.CARD ? 'PUNTO' : 'ZELLE',
            monto: isBs ? (montoBs ?? totalAmount) : totalAmount,
            tasaCambio: montoBs ? +(montoBs / montoUsd).toFixed(4) : 1,
            tenantId: oc.org.id,
          },
        });
      }

      // Tasks for some invoices (credit / pending → cobranza)
      if (status === 'PENDING' || Math.random() < 0.3) {
        const asignee = pick(orgUsers.filter(u => u.role !== 'WAREHOUSE'));
        await prisma.task.create({
          data: {
            title: status === 'PENDING' ? `Cobrar factura #${invoice.id}` : `Revisar factura #${invoice.id}`,
            description: faker.lorem.sentence(),
            status: weightedPick(['PENDING', 'IN_PROGRESS', 'DONE'] as TaskStatus[], [40, 25, 35]),
            priority: status === 'PENDING' ? 'HIGH' : 'LOW',
            organizationId: oc.org.id,
            assignedToId: asignee.userId,
            createdById: seller.userId,
            invoiceId: invoice.id,
            dueDate: new Date(today.getTime() + randomInt(1, 30) * 86400000),
            category: 'COBRANZA',
          },
        });
      }
    }
    console.log(`✅ 30 facturas + items + pagos + tareas — ${oc.org.nombre}`);
  }

  // ── 9. Credit accounts for some customers ──────────────────────────────────
  for (const oc of orgs) {
    const orgCustomers = createdCustomers.filter(c => c.organizationId === oc.org.id);
    const creditCustomers = orgCustomers.slice(0, 5); // first 5 have credit
    for (const c of creditCustomers) {
      const limit = randomInt(100, 1000);
      const balance = randomInt(0, limit);
      const credit = await prisma.customerCredit.upsert({
        where: { customerId: c.id },
        update: { limitAmount: limit, currentBalance: balance },
        create: {
          customerId: c.id,
          organizationId: oc.org.id,
          limitAmount: limit,
          currentBalance: balance,
          creditDueDays: 30,
          status: 'ACTIVE',
        },
      });

      // Some transactions
      if (balance > 0) {
        await prisma.creditTransaction.create({
          data: {
            creditId: credit.id,
            type: 'CHARGE',
            amountUsd: balance,
            amountBs: +(balance * randomInt(45, 55)).toFixed(2),
            exchangeRate: randomInt(45, 55),
            description: 'Saldo inicial',
          },
        });
      }
    }
    console.log(`✅ 5 cuentas de crédito — ${oc.org.nombre}`);
  }

  // ── 10. Expenses with payments (10 per org) ────────────────────────────────
  for (const oc of orgs) {
    const orgSuppliers = createdSuppliers.filter(s => s.organizationId === oc.org.id);
    const orgCategories = await prisma.expenseCategory.findMany({ where: { organizationId: oc.org.id } });
    const orgUsers = oc.users;

    for (let i = 0; i < 10; i++) {
      const supplier = pick(orgSuppliers);
      const category = pick(orgCategories);
      const amount = +faker.commerce.price({ min: 20, max: 2000, dec: 2 });
      const daysAgo = randomInt(1, 45);
      const isPaid = Math.random() < 0.6;
      const expense = await prisma.expense.create({
        data: {
          companyId: oc.company.id,
          organizationId: oc.org.id,
          date: new Date(Date.now() - daysAgo * 86400000),
          amount,
          description: faker.commerce.productName(),
          referenceNumber: `FAC-${faker.string.alphanumeric(8).toUpperCase()}`,
          status: isPaid ? 'PAID' : 'PENDING',
          supplierId: supplier.id,
          categoryId: category.id,
          baseGeneral: amount,
          ivaAmount: +(amount * 0.16).toFixed(2),
        },
      });

      if (isPaid) {
        await prisma.expensePayment.create({
          data: {
            organizationId: oc.org.id,
            expenseId: expense.id,
            amount,
            paidAt: new Date(Date.now() - randomInt(1, 30) * 86400000),
          },
        });
      }
    }
    console.log(`✅ 10 gastos — ${oc.org.nombre}`);
  }

  // ── 11. Inventory movements (15 per org) ───────────────────────────────────
  for (const oc of orgs) {
    const orgProducts = await prisma.product.findMany({ where: { organizationId: oc.org.id, isActive: true } });
    const orgUsers = oc.users;

    for (let i = 0; i < 15; i++) {
      const product = pick(orgProducts);
      const user = pick(orgUsers);
      const type = weightedPick(
        [MovementType.VENTA, MovementType.COMPRA, MovementType.AUTOCONSUMO, MovementType.MERMA_VENCIDO, MovementType.MERMA_DANADO],
        [35, 25, 15, 12, 13],
      );
      const qty = type === MovementType.COMPRA ? randomInt(5, 50) : randomInt(1, 10);
      const reason = type === MovementType.AUTOCONSUMO ? pick(['Consumo interno', 'Uso en cocina', 'Degustación']) :
                     type === MovementType.MERMA_VENCIDO ? pick(['Producto vencido', 'Fecha de expiración pasada']) :
                     type === MovementType.MERMA_DANADO ? pick(['Botella rota', 'Envase dañado', 'Derrame']) : null;

      await prisma.inventoryMovement.create({
        data: {
          type,
          quantity: type === MovementType.COMPRA ? qty : -qty,
          reason,
          productId: product.id,
          userId: user.userId,
          tenantId: oc.org.id,
          unitCostAtTransaction: Number(product.costPrice),
          consumptionReason: type === MovementType.AUTOCONSUMO || type === MovementType.MERMA_VENCIDO || type === MovementType.MERMA_DANADO
            ? pick([ConsumptionReason.MERMA, ConsumptionReason.MUESTRAS, ConsumptionReason.USO_OPERATIVO])
            : undefined,
        },
      });

      // Update stock
      const delta = type === MovementType.COMPRA ? qty : -qty;
      await prisma.product.update({
        where: { id: product.id },
        data: { stock: { increment: delta } },
      });
    }
    console.log(`✅ 15 movimientos de inventario — ${oc.org.nombre}`);
  }

  // ── 12. Tasa histórica (one per org per day for last 14 days) ──────────────
  for (const oc of orgs) {
    let rate = 48.0;
    for (let d = 14; d >= 0; d--) {
      rate = +(rate + (Math.random() - 0.4) * 1.5).toFixed(4);
      if (rate < 40) rate = 40;
      if (rate > 60) rate = 60;
      const date = new Date(Date.now() - d * 86400000);
      await prisma.tasaHistorica.create({
        data: {
          organizationId: oc.org.id,
          rate,
          source: 'BCV',
          effectiveAt: new Date(date.setHours(12, 0, 0, 0)),
        },
      });
    }
    console.log(`✅ 15 tasas históricas — ${oc.org.nombre}`);
  }

  // ── 13. Activity logs (10 per org) ─────────────────────────────────────────
  for (const oc of orgs) {
    const orgUsers = oc.users;
    for (let i = 0; i < 10; i++) {
      const user = pick(orgUsers);
      const actions = ['PRODUCT_PRICE_UPDATE', 'INVOICE_DELETED', 'AUTOCONSUMO_REGISTERED', 'CIERRE_CAJA', 'INVENTORY_ADJUSTMENT'];
      await prisma.activityLog.create({
        data: {
          organizationId: oc.org.id,
          userId: user.userId,
          action: pick(actions),
          entityType: pick(['product', 'invoice', 'inventory_movement']),
          entityId: String(randomInt(1, 500)),
          oldValue: { someField: 'old_value' },
          newValue: { someField: 'new_value' },
          summary: faker.lorem.sentence(),
        },
      });
    }
    console.log(`✅ 10 activity logs — ${oc.org.nombre}`);
  }

  console.log('\n🎉 Seed DEV completado exitosamente!');
  console.log(`   Super Admin: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
  console.log(`   Organizaciones: ${orgs.length}`);
  console.log(`   Usuarios: ${allUsers.length}`);
}

seed()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
