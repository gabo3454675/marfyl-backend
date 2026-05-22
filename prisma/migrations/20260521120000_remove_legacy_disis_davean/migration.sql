-- Elimina tablas y tipos del sistema legacy DISIS / inspecciones Davean (MARFYL).

DROP TABLE IF EXISTS "disis_transactions";
DROP TABLE IF EXISTS "disis_clients";
DROP TABLE IF EXISTS "vehicle_inspections";

DROP TYPE IF EXISTS "DisisInventorySyncStatus";
DROP TYPE IF EXISTS "DisisTransactionStatus";
DROP TYPE IF EXISTS "DisisTransactionType";
