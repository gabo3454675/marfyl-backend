CREATE TYPE "FloorTableAccountStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "floor_tables" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "label" TEXT NOT NULL,
  "zone" TEXT NOT NULL DEFAULT '',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "capacity" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "floor_tables_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "floor_tables_organizationId_label_key" ON "floor_tables"("organizationId", "label");
CREATE INDEX "floor_tables_organizationId_isActive_sortOrder_idx" ON "floor_tables"("organizationId", "isActive", "sortOrder");

CREATE TABLE "floor_table_accounts" (
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
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "floor_table_accounts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "floor_table_accounts_openKey_key" ON "floor_table_accounts"("openKey");
CREATE UNIQUE INDEX "floor_table_accounts_closedInvoiceId_key" ON "floor_table_accounts"("closedInvoiceId");
CREATE INDEX "floor_table_accounts_organizationId_status_idx" ON "floor_table_accounts"("organizationId", "status");
CREATE INDEX "floor_table_accounts_tableId_status_idx" ON "floor_table_accounts"("tableId", "status");

CREATE TABLE "floor_table_payments" (
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
CREATE INDEX "floor_table_payments_accountId_createdAt_idx" ON "floor_table_payments"("accountId", "createdAt");

ALTER TABLE "floor_orders" ADD COLUMN "tableId" INTEGER, ADD COLUMN "tableAccountId" INTEGER;
CREATE INDEX "floor_orders_tableId_status_idx" ON "floor_orders"("tableId", "status");
CREATE INDEX "floor_orders_tableAccountId_idx" ON "floor_orders"("tableAccountId");

ALTER TABLE "floor_tables" ADD CONSTRAINT "floor_tables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "floor_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "floor_table_accounts" ADD CONSTRAINT "floor_table_accounts_closedInvoiceId_fkey" FOREIGN KEY ("closedInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "floor_table_payments" ADD CONSTRAINT "floor_table_payments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "floor_table_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "floor_table_payments" ADD CONSTRAINT "floor_table_payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "floor_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_tableAccountId_fkey" FOREIGN KEY ("tableAccountId") REFERENCES "floor_table_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
