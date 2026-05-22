-- CreateEnum
CREATE TYPE "ConsumptionReason" AS ENUM ('MERMA', 'MUESTRAS', 'USO_OPERATIVO');

-- AlterTable: InventoryMovement - costo al momento y clasificación
ALTER TABLE "inventory_movements" ADD COLUMN "unitCostAtTransaction" DECIMAL(10,2),
ADD COLUMN "consumptionReason" "ConsumptionReason";

-- AlterTable: Expense - vínculo con movimiento para doble asiento
ALTER TABLE "expenses" ADD COLUMN "inventoryMovementId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "expenses_inventoryMovementId_key" ON "expenses"("inventoryMovementId");
CREATE INDEX "inventory_movements_consumptionReason_idx" ON "inventory_movements"("consumptionReason");
CREATE INDEX "expenses_inventoryMovementId_idx" ON "expenses"("inventoryMovementId");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_inventoryMovementId_fkey" 
  FOREIGN KEY ("inventoryMovementId") REFERENCES "inventory_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
