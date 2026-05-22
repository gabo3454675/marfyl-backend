-- Add consecutive number per organization/company (each tenant has its own sequence 1, 2, 3...)
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "consecutiveNumber" INTEGER;

-- Backfill: assign 1, 2, 3... per organization (where organization_id is set)
WITH ord AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY id) AS rn
  FROM "invoices"
  WHERE "organizationId" IS NOT NULL
)
UPDATE "invoices" i
SET "consecutiveNumber" = ord.rn
FROM ord
WHERE i.id = ord.id AND i."organizationId" IS NOT NULL;

-- Backfill: assign 1, 2, 3... per company for legacy rows (organization_id null)
WITH ord AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY id) AS rn
  FROM "invoices"
  WHERE "organizationId" IS NULL
)
UPDATE "invoices" i
SET "consecutiveNumber" = ord.rn
FROM ord
WHERE i.id = ord.id AND i."organizationId" IS NULL;

-- Ensure any remaining nulls get a value (e.g. orphan rows) so we can set default for new rows
UPDATE "invoices" SET "consecutiveNumber" = id WHERE "consecutiveNumber" IS NULL;
