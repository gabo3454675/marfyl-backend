-- Organizaciones fundadoras: suscripción gratuita + concierto por org
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "billingExempt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "concertModuleEnabled" BOOLEAN NOT NULL DEFAULT false;
