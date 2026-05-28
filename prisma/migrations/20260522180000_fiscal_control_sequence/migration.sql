ALTER TABLE "fiscal_profiles" ADD COLUMN "controlSeriesPrefix" TEXT DEFAULT '01';
ALTER TABLE "fiscal_profiles" ADD COLUMN "nextControlSequence" INTEGER NOT NULL DEFAULT 1;
