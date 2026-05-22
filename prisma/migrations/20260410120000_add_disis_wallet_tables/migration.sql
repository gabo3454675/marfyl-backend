-- CreateEnum
CREATE TYPE "DisisTransactionType" AS ENUM ('RECHARGE', 'CONSUMPTION');

-- CreateEnum
CREATE TYPE "DisisTransactionStatus" AS ENUM ('PENDING', 'SYNCED');

-- CreateEnum
CREATE TYPE "DisisInventorySyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "disis_clients" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "nationalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "qrSecret" TEXT NOT NULL,
    "pin" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disis_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disis_transactions" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "clientId" INTEGER NOT NULL,
    "productId" INTEGER,
    "idempotencyKey" TEXT,
    "type" "DisisTransactionType" NOT NULL,
    "status" "DisisTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(15,2) NOT NULL,
    "quantity" DECIMAL(15,4),
    "inventorySyncStatus" "DisisInventorySyncStatus" NOT NULL DEFAULT 'PENDING',
    "disisInventoryMovementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disis_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "disis_clients_organizationId_nationalId_key" ON "disis_clients"("organizationId", "nationalId");

-- CreateIndex
CREATE INDEX "disis_clients_organizationId_idx" ON "disis_clients"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "disis_transactions_organizationId_idempotencyKey_key" ON "disis_transactions"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "disis_transactions_organizationId_status_idx" ON "disis_transactions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "disis_transactions_organizationId_inventorySyncStatus_idx" ON "disis_transactions"("organizationId", "inventorySyncStatus");

-- CreateIndex
CREATE INDEX "disis_transactions_clientId_idx" ON "disis_transactions"("clientId");

-- CreateIndex
CREATE INDEX "disis_transactions_productId_idx" ON "disis_transactions"("productId");

-- AddForeignKey
ALTER TABLE "disis_clients" ADD CONSTRAINT "disis_clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disis_transactions" ADD CONSTRAINT "disis_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disis_transactions" ADD CONSTRAINT "disis_transactions_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "disis_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disis_transactions" ADD CONSTRAINT "disis_transactions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
