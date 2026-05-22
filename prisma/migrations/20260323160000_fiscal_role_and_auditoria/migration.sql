-- AlterEnum: rol SAC (fiscal). Requiere PostgreSQL 12+ para ejecutarse dentro de transacción.
ALTER TYPE "Role" ADD VALUE 'FISCAL';

-- CreateTable
CREATE TABLE "auditorias" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "accion" TEXT NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidad_id" TEXT NOT NULL,
    "valores_anteriores" JSONB,
    "valores_nuevos" JSONB,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auditorias_usuario_id_idx" ON "auditorias"("usuario_id");

-- CreateIndex
CREATE INDEX "auditorias_entidad_idx" ON "auditorias"("entidad");

-- CreateIndex
CREATE INDEX "auditorias_fecha_idx" ON "auditorias"("fecha");

-- CreateIndex
CREATE INDEX "auditorias_entidad_entidad_id_idx" ON "auditorias"("entidad", "entidad_id");

-- AddForeignKey
ALTER TABLE "auditorias" ADD CONSTRAINT "auditorias_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
