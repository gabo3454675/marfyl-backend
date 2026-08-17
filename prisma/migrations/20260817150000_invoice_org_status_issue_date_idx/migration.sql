-- Filtro de liquor-sales: organizationId + status + issueDate (rango UTC del día Caracas)
CREATE INDEX IF NOT EXISTS "invoices_organizationId_status_issueDate_idx"
  ON "invoices"("organizationId", "status", "issueDate");
