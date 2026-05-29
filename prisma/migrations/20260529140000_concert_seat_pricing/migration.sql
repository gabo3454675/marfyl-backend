-- Precio fijo por asiento (USD + Bs) y layout por mesa
ALTER TABLE "concert_seats" ADD COLUMN IF NOT EXISTS "priceUsd" DOUBLE PRECISION;
ALTER TABLE "concert_seats" ADD COLUMN IF NOT EXISTS "priceBs" DOUBLE PRECISION;
ALTER TABLE "concert_seats" ADD COLUMN IF NOT EXISTS "mesaNumber" INTEGER;
ALTER TABLE "concert_seats" ADD COLUMN IF NOT EXISTS "displayNumber" INTEGER;
ALTER TABLE "concert_seats" ADD COLUMN IF NOT EXISTS "tierCode" TEXT;
ALTER TABLE "concert_seats" ADD COLUMN IF NOT EXISTS "tierLabel" TEXT;

ALTER TABLE "concert_events" ADD COLUMN IF NOT EXISTS "priceBsVip" DOUBLE PRECISION;
