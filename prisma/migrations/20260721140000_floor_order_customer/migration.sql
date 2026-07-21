ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "customerName" TEXT;
ALTER TABLE "floor_orders" ADD COLUMN IF NOT EXISTS "customerId" INTEGER;

DO $$ BEGIN
  ALTER TABLE "floor_orders" ADD CONSTRAINT "floor_orders_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "floor_orders_customerId_idx" ON "floor_orders"("customerId");
