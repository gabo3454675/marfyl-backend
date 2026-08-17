-- TASK-002: Idempotent floor + saleMode DDL for STAGING only
-- Target host must contain: ep-curly-star
-- DO NOT run against ep-super-art (prod)

-- ========== Floor* enums ==========
DO $$ BEGIN
  CREATE TYPE "FloorOrderStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PREP', 'READY', 'CHARGED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FloorStation" AS ENUM ('BAR', 'KITCHEN', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FloorPaymentMode" AS ENUM ('INMEDIATO', 'CUENTA_ABIERTA');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "FloorTableAccountStatus" AS ENUM ('OPEN', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- SaleMode already exists on staging in many envs — create only if missing (no conflicting recreate)
DO $$ BEGIN
  CREATE TYPE "SaleMode" AS ENUM ('STANDARD', 'DESCORCHE', 'COMBO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ========== floor_tables ==========
CREATE TABLE IF NOT EXISTS "floor_tables" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "zone" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "capacity" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "floor_tables_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "floor_tables_organizationId_label_key" ON "floor_tables"("organizationId", "label");
CREATE INDEX IF NOT EXISTS "floor_tables_organizationId_isActive_sortOrder_idx" ON "floor_tables"("organizationId", "isActive", "sortOrder");

-- ========== floor_table_accounts ==========
CREATE TABLE IF NOT EXISTS "floor_table_accounts" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "tableId" INTEGER NOT NULL,
  "customerId" INTEGER,
  "customerName" TEXT,
  "status" "FloorTableAccountStatus" NOT NULL DEFAULT 'OPEN',
  "openKey" TEXT,
  "openedById" INTEGER NOT NULL,
  "closedInvoiceId" INTEGER,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "floor_table_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "floor_table_accounts_openKey_key" ON "floor_table_accounts"("openKey");
CREATE UNIQUE INDEX IF NOT EXISTS "floor_table_accounts_closedInvoiceId_key" ON "floor_table_accounts"("closedInvoiceId");
CREATE INDEX IF NOT EXISTS "floor_table_accounts_organizationId_status_idx" ON "floor_table_accounts"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "floor_table_accounts_tableId_status_idx" ON "floor_table_accounts"("tableId", "status");

-- ========== floor_table_payments ==========
CREATE TABLE IF NOT EXISTS "floor_table_payments" (
  "id" SERIAL NOT NULL,
  "accountId" INTEGER NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "method" TEXT NOT NULL,
  "notes" TEXT,
  "recordedById" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "floor_table_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "floor_table_payments_accountId_createdAt_idx" ON "floor_table_payments"("accountId", "createdAt");

-- ========== floor_orders ==========
CREATE TABLE IF NOT EXISTS "floor_orders" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "tableLabel" TEXT NOT NULL,
  "status" "FloorOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "createdById" INTEGER NOT NULL,
  "chargedInvoiceId" INTEGER,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "chargedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "floor_orders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "customerId" INTEGER;
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "zone" TEXT NOT NULL DEFAULT '';
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "paymentMode" "FloorPaymentMode" NOT NULL DEFAULT 'INMEDIATO';
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "isOpen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "tableId" INTEGER;
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "tableAccountId" INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS "floor_orders_chargedInvoiceId_key" ON "floor_orders"("chargedInvoiceId");
CREATE INDEX IF NOT EXISTS "floor_orders_organizationId_status_idx" ON "floor_orders"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "floor_orders_organizationId_createdAt_idx" ON "floor_orders"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "floor_orders_customerId_idx" ON "floor_orders"("customerId");
CREATE INDEX IF NOT EXISTS "floor_orders_organizationId_paymentMode_isOpen_idx" ON "floor_orders"("organizationId", "paymentMode", "isOpen");
CREATE INDEX IF NOT EXISTS "floor_orders_tableId_status_idx" ON "floor_orders"("tableId", "status");
CREATE INDEX IF NOT EXISTS "floor_orders_tableAccountId_idx" ON "floor_orders"("tableAccountId");

-- ========== floor_order_items ==========
CREATE TABLE IF NOT EXISTS "floor_order_items" (
  "id" SERIAL NOT NULL,
  "floorOrderId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(10,2) NOT NULL,
  "notes" TEXT,
  "station" "FloorStation" NOT NULL DEFAULT 'OTHER',
  CONSTRAINT "floor_order_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "floor_order_items" ADD COLUMN IF NOT EXISTS "saleMode" "SaleMode" NOT NULL DEFAULT 'STANDARD';

CREATE INDEX IF NOT EXISTS "floor_order_items_floorOrderId_idx" ON "floor_order_items"("floorOrderId");
CREATE INDEX IF NOT EXISTS "floor_order_items_productId_idx" ON "floor_order_items"("productId");

-- Defense: ensure updatedAt defaults exist if table was created without them
ALTER TABLE "floor_tables" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "floor_table_accounts" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "floor_orders" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ========== Foreign keys (idempotent) ==========
DO $$ BEGIN
  ALTER TABLE "floor_tables" ADD CONSTRAINT "floor_tables_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "floor_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_openedById_fkey"
    FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_closedInvoiceId_fkey"
    FOREIGN KEY ("closedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_payments" ADD CONSTRAINT "floor_table_payments_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "floor_table_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_table_payments" ADD CONSTRAINT "floor_table_payments_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_chargedInvoiceId_fkey"
    FOREIGN KEY ("chargedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_tableId_fkey"
    FOREIGN KEY ("tableId") REFERENCES "floor_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_tableAccountId_fkey"
    FOREIGN KEY ("tableAccountId") REFERENCES "floor_table_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_order_items" ADD CONSTRAINT "floor_order_items_floorOrderId_fkey"
    FOREIGN KEY ("floorOrderId") REFERENCES "floor_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_order_items" ADD CONSTRAINT "floor_order_items_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
