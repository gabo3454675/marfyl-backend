-- Fail-closed: issueDate obligatorio en invoices.
-- Idempotente: backfill residual nulls → createdAt, luego NOT NULL.

UPDATE "invoices"
SET "issueDate" = "createdAt"
WHERE "issueDate" IS NULL;

ALTER TABLE "invoices"
ALTER COLUMN "issueDate" SET NOT NULL;
