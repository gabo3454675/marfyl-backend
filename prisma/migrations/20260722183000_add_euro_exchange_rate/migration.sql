-- Tasa EUR/VES informativa; exchangeRate sigue reservado para USD/VES.
ALTER TABLE "organizations"
  ADD COLUMN "euroExchangeRate" DOUBLE PRECISION,
  ADD COLUMN "euroRateUpdatedAt" TIMESTAMP(3);

CREATE TABLE "tasas_euro_historicas" (
  "id" SERIAL NOT NULL,
  "organizationId" INTEGER NOT NULL,
  "rate" DECIMAL(12,4) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'BCV_EUR',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "tasas_euro_historicas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tasas_euro_historicas_organizationId_idx"
  ON "tasas_euro_historicas"("organizationId");
CREATE INDEX "tasas_euro_historicas_effectiveAt_idx"
  ON "tasas_euro_historicas"("effectiveAt");

ALTER TABLE "tasas_euro_historicas"
  ADD CONSTRAINT "tasas_euro_historicas_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
