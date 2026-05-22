import { Module } from '@nestjs/common';
import { PrismaModule } from '@/common/prisma/prisma.module';
import { UploadModule } from '@/common/services/upload.module';
import { ActivityLogModule } from '@/modules/activity-log/activity-log.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, UploadModule, ActivityLogModule, NotificationsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
