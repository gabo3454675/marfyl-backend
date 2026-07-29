-- Plan B: lectura canónica de líneas + legado de cobro histórico
-- CREATE TYPE debe existir ANTES del ALTER TABLE que lo referencia.

-- Enums idempotentes (seguros tras fallo parcial en Neon SQL editor)
DO $$ BEGIN
  CREATE TYPE "InvoiceItemRecordClass" AS ENUM ('OPERATIONAL', 'RECONCILED_HISTORY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "InvoiceItemLineageStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSED_LEGACY';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Invoice.sellerId nullable (imports históricos sin vendedor en fuente)
ALTER TABLE "invoices" ALTER COLUMN "sellerId" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "invoices_isLegacyImport_idx" ON "invoices"("isLegacyImport");

-- InvoiceItem: class/lineage + source quantities
ALTER TABLE "invoice_items" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "invoice_items" ALTER COLUMN "quantity" DROP NOT NULL;

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "recordClass" "InvoiceItemRecordClass" NOT NULL DEFAULT 'OPERATIONAL',
  ADD COLUMN IF NOT EXISTS "lineageStatus" "InvoiceItemLineageStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "sourceHash" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceLineKey" CHAR(64),
  ADD COLUMN IF NOT EXISTS "sourceSkuExact" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceQuantity" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "sourceDetailedQuantity" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "effectiveQuantity" DECIMAL(18,4);

-- C1 OPERATIONAL ⇒ productId + quantity NOT NULL
ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_c1_operational";
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_c1_operational" CHECK (
  "recordClass" <> 'OPERATIONAL'
  OR ("productId" IS NOT NULL AND "quantity" IS NOT NULL)
);

-- C2 RECONCILED_HISTORY ⇒ identidad fuente + cantidades + (product OR textos)
ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_c2_reconciled";
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_c2_reconciled" CHECK (
  "recordClass" <> 'RECONCILED_HISTORY'
  OR (
    "sourceHash" IS NOT NULL
    AND "sourceLineKey" IS NOT NULL
    AND char_length(btrim("sourceLineKey")) = 64
    AND "sourceQuantity" IS NOT NULL
    AND "effectiveQuantity" IS NOT NULL
    AND (
      "productId" IS NOT NULL
      OR (
        "sourceSkuExact" IS NOT NULL AND char_length(btrim("sourceSkuExact")) > 0
        AND "sourceDescription" IS NOT NULL AND char_length(btrim("sourceDescription")) > 0
      )
    )
  )
);

-- C3 productId null ⇒ textos fuente
ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_c3_null_product_texts";
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_c3_null_product_texts" CHECK (
  "productId" IS NOT NULL
  OR (
    "sourceSkuExact" IS NOT NULL AND char_length(btrim("sourceSkuExact")) > 0
    AND "sourceDescription" IS NOT NULL AND char_length(btrim("sourceDescription")) > 0
  )
);

-- C4 RECONCILED_HISTORY nunca guarda quantity Int
ALTER TABLE "invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_c4_reconciled_qty_null";
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_c4_reconciled_qty_null" CHECK (
  "recordClass" <> 'RECONCILED_HISTORY'
  OR "quantity" IS NULL
);

-- UNIQUE parcial: identidad fuente solo en ACTIVE
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_items_active_source_identity_uidx"
  ON "invoice_items" ("sourceHash", "sourceLineKey")
  WHERE "lineageStatus" = 'ACTIVE'
    AND "sourceHash" IS NOT NULL
    AND "sourceLineKey" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "invoice_items_lineage_class_idx"
  ON "invoice_items" ("lineageStatus", "recordClass");

CREATE INDEX IF NOT EXISTS "invoice_items_null_product_sku_idx"
  ON "invoice_items" ("sourceSkuExact")
  WHERE "productId" IS NULL;

-- Vista canónica ACTIVE-only
CREATE OR REPLACE VIEW "invoice_items_canonical" AS
SELECT
  ii.*,
  p.sku AS product_sku,
  p.name AS product_name,
  COALESCE(p.name, ii."sourceDescription") AS display_name,
  COALESCE(p.sku, ii."sourceSkuExact") AS display_sku,
  COALESCE(ii.quantity::numeric, ii."effectiveQuantity") AS display_quantity,
  upper(regexp_replace(btrim(COALESCE(ii."sourceSkuExact", '')), '\s+', '', 'g')) AS sku_group_key
FROM "invoice_items" ii
LEFT JOIN "products" p ON p.id = ii."productId"
WHERE ii."lineageStatus" = 'ACTIVE';
