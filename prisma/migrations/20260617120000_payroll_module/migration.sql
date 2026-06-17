-- CreateEnum
CREATE TYPE "PayrollPayType" AS ENUM ('FIXED', 'COMMISSION', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayrollProfileStatus" AS ENUM ('PENDING', 'REVIEW', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "payroll_profiles" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "payType" "PayrollPayType" NOT NULL DEFAULT 'FIXED',
    "baseSalary" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "commissionPct" DECIMAL(5,2),
    "hoursWorked" DECIMAL(8,2),
    "bonuses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" "PayrollProfileStatus" NOT NULL DEFAULT 'PENDING',
    "lastProcessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "processedById" INTEGER NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "employeeCount" INTEGER NOT NULL DEFAULT 0,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'COMPLETED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_lines" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "payrollRunId" INTEGER NOT NULL,
    "payrollProfileId" INTEGER,
    "memberId" INTEGER NOT NULL,
    "employeeName" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "baseAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "bonuses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "expenseId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_profiles_memberId_key" ON "payroll_profiles"("memberId");

-- CreateIndex
CREATE INDEX "payroll_profiles_organizationId_idx" ON "payroll_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_profiles_status_idx" ON "payroll_profiles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_profiles_organizationId_memberId_key" ON "payroll_profiles"("organizationId", "memberId");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_idx" ON "payroll_runs"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_runs_createdAt_idx" ON "payroll_runs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_lines_expenseId_key" ON "payroll_lines"("expenseId");

-- CreateIndex
CREATE INDEX "payroll_lines_payrollRunId_idx" ON "payroll_lines"("payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_lines_organizationId_idx" ON "payroll_lines"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_lines_memberId_idx" ON "payroll_lines"("memberId");

-- AddForeignKey
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payrollProfileId_fkey" FOREIGN KEY ("payrollProfileId") REFERENCES "payroll_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
