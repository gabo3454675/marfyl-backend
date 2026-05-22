-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('CHARGE', 'PAYMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('paid', 'partial', 'pending_credit');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'paid';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "category" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "limitAmount" DECIMAL(15,2) NOT NULL,
    "currentBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "CreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditDueDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" SERIAL NOT NULL,
    "creditId" INTEGER NOT NULL,
    "invoiceId" INTEGER,
    "type" "CreditTransactionType" NOT NULL,
    "amountUsd" DECIMAL(15,2) NOT NULL,
    "amountBs" DECIMAL(15,2) NOT NULL,
    "exchangeRate" DECIMAL(12,4) NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_credits_customerId_key" ON "customer_credits"("customerId");

-- CreateIndex
CREATE INDEX "customer_credits_customerId_idx" ON "customer_credits"("customerId");

-- CreateIndex
CREATE INDEX "customer_credits_organizationId_idx" ON "customer_credits"("organizationId");

-- CreateIndex
CREATE INDEX "customer_credits_status_idx" ON "customer_credits"("status");

-- CreateIndex
CREATE INDEX "credit_transactions_creditId_idx" ON "credit_transactions"("creditId");

-- CreateIndex
CREATE INDEX "credit_transactions_invoiceId_idx" ON "credit_transactions"("invoiceId");

-- CreateIndex
CREATE INDEX "credit_transactions_createdAt_idx" ON "credit_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "invoices_paymentStatus_idx" ON "invoices"("paymentStatus");

-- CreateIndex
CREATE INDEX "tasks_category_idx" ON "tasks"("category");

-- CreateIndex
CREATE INDEX "tasks_dueDate_idx" ON "tasks"("dueDate");

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "customer_credits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
