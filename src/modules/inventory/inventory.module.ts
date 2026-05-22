import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/prisma/prisma.module';
import { ActivityLogModule } from '@/modules/activity-log/activity-log.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryMovementsController } from './inventory-movements.controller';
import { InventoryMovementsService } from './inventory-movements.service';

@Module({
  imports: [PrismaModule, ActivityLogModule, NotificationsModule],
  controllers: [InventoryController, InventoryMovementsController],
  providers: [InventoryService, InventoryMovementsService],
  exports: [InventoryService, InventoryMovementsService],
})
export class InventoryModule {}
