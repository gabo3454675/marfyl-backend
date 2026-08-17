-- CreateEnum SaleMode (STANDARD | DESCORCHE | COMBO)
DO $$ BEGIN
  CREATE TYPE "SaleMode" AS ENUM ('STANDARD', 'DESCORCHE', 'COMBO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- InvoiceItem.saleMode
ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "saleMode" "SaleMode" NOT NULL DEFAULT 'STANDARD';

-- FloorOrderItem.saleMode
ALTER TABLE "floor_order_items"
  ADD COLUMN IF NOT EXISTS "saleMode" "SaleMode" NOT NULL DEFAULT 'STANDARD';
