-- Reasigna datos operativos de Marfyl Demo → Davean (por slug).
-- Ejecutar una sola vez. Davean debe estar vacío.

BEGIN;

DO $$
DECLARE
  demo_id INT := (SELECT id FROM organizations WHERE slug = 'marfyl-demo');
  davean_id INT := (SELECT id FROM organizations WHERE slug = 'davean');
BEGIN
  IF demo_id IS NULL OR davean_id IS NULL THEN
    RAISE EXCEPTION 'Orgs marfyl-demo o davean no encontradas';
  END IF;

  UPDATE products SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE customers SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE suppliers SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE invoices SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE expenses SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE expense_categories SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE tasks SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE inventory_movements SET "tenantId" = davean_id WHERE "tenantId" = demo_id;
  UPDATE cierres_caja SET "tenantId" = davean_id WHERE "tenantId" = demo_id;
  UPDATE customer_credits SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE invitations SET "organizationId" = davean_id WHERE "organizationId" = demo_id;
  UPDATE concert_events SET "organizationId" = davean_id WHERE "organizationId" = demo_id;

  -- Perfil fiscal: demo → davean (unique por org)
  UPDATE fiscal_profiles SET "organizationId" = davean_id
  WHERE "organizationId" = demo_id
    AND NOT EXISTS (SELECT 1 FROM fiscal_profiles WHERE "organizationId" = davean_id);

  UPDATE members m
  SET "organizationId" = davean_id
  WHERE m."organizationId" = demo_id
    AND NOT EXISTS (
      SELECT 1 FROM members m2
      WHERE m2."userId" = m."userId" AND m2."organizationId" = davean_id
    );
  DELETE FROM members WHERE "organizationId" = demo_id;

  RAISE NOTICE 'Migración demo (id=%) → davean (id=%) OK', demo_id, davean_id;
END $$;

COMMIT;
