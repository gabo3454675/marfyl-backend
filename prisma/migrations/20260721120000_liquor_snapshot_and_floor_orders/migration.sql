-- AlterTable
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "FloorOrderStatus" AS ENUM ('DRAFT', 'SENT', 'IN_PREP', 'READY', 'CHARGED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "FloorStation" AS ENUM ('BAR', 'KITCHEN', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquor_day_snapshots" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "productId" INTEGER NOT NULL,
    "openingStock" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "liquor_day_snapshots_pkey" PRIMARY KEY ("id")
);

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

CREATE UNIQUE INDEX IF NOT EXISTS "liquor_day_snapshots_organizationId_day_productId_key" ON "liquor_day_snapshots"("organizationId", "day", "productId");
CREATE INDEX IF NOT EXISTS "liquor_day_snapshots_organizationId_day_idx" ON "liquor_day_snapshots"("organizationId", "day");

CREATE UNIQUE INDEX IF NOT EXISTS "floor_orders_chargedInvoiceId_key" ON "floor_orders"("chargedInvoiceId");
CREATE INDEX IF NOT EXISTS "floor_orders_organizationId_status_idx" ON "floor_orders"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "floor_orders_organizationId_createdAt_idx" ON "floor_orders"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "floor_order_items_floorOrderId_idx" ON "floor_order_items"("floorOrderId");
CREATE INDEX IF NOT EXISTS "floor_order_items_productId_idx" ON "floor_order_items"("productId");

DO $$ BEGIN
  ALTER TABLE "liquor_day_snapshots" ADD CONSTRAINT "liquor_day_snapshots_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "liquor_day_snapshots" ADD CONSTRAINT "liquor_day_snapshots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_chargedInvoiceId_fkey" FOREIGN KEY ("chargedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_order_items" ADD CONSTRAINT "floor_order_items_floorOrderId_fkey" FOREIGN KEY ("floorOrderId") REFERENCES "floor_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "floor_order_items" ADD CONSTRAINT "floor_order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
