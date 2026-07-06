-- Add index on taxId for supplier search optimization
CREATE INDEX IF NOT EXISTS "suppliers_taxId_idx" ON "suppliers"("taxId");
