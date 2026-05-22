-- CreateTable: Tasas históricas (BCV al momento de factura/cierre)
CREATE TABLE "tasas_historicas" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "rate" DECIMAL(12,4) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'BCV',
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasas_historicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Activity Log (auditoría de acciones)
CREATE TABLE "activity_logs" (
    "id" SERIAL NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: FCM Tokens (notificaciones push)
CREATE TABLE "fcm_tokens" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fcm_tokens_pkey" PRIMARY KEY ("id")
);

-- AddColumn: Invoice.tasaHistoricaId
ALTER TABLE "invoices" ADD COLUMN "tasaHistoricaId" INTEGER;

-- AddColumn: CierreCaja.tasaHistoricaId
ALTER TABLE "cierres_caja" ADD COLUMN "tasaHistoricaId" INTEGER;

-- CreateIndex
CREATE INDEX "tasas_historicas_organizationId_idx" ON "tasas_historicas"("organizationId");
CREATE INDEX "tasas_historicas_effectiveAt_idx" ON "tasas_historicas"("effectiveAt");

CREATE INDEX "activity_logs_organizationId_idx" ON "activity_logs"("organizationId");
CREATE INDEX "activity_logs_userId_idx" ON "activity_logs"("userId");
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");
CREATE INDEX "activity_logs_createdAt_idx" ON "activity_logs"("createdAt");

CREATE UNIQUE INDEX "fcm_tokens_token_key" ON "fcm_tokens"("token");
CREATE INDEX "fcm_tokens_userId_idx" ON "fcm_tokens"("userId");

CREATE INDEX "invoices_tasaHistoricaId_idx" ON "invoices"("tasaHistoricaId");
CREATE INDEX "cierres_caja_tasaHistoricaId_idx" ON "cierres_caja"("tasaHistoricaId");

-- AddForeignKey
ALTER TABLE "tasas_historicas" ADD CONSTRAINT "tasas_historicas_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fcm_tokens" ADD CONSTRAINT "fcm_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tasaHistoricaId_fkey" FOREIGN KEY ("tasaHistoricaId") REFERENCES "tasas_historicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cierres_caja" ADD CONSTRAINT "cierres_caja_tasaHistoricaId_fkey" FOREIGN KEY ("tasaHistoricaId") REFERENCES "tasas_historicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
