import { Module } from '@nestjs/common';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { CierreCajaController } from './cierre-caja.controller';
import { CierreCajaPublicController } from './cierre-caja-public.controller';
import { CierreCajaService } from './cierre-caja.service';
import { CierreCajaSchedulerService } from './cierre-caja-scheduler.service';

@Module({
  imports: [NotificationsModule],
  controllers: [CierreCajaController, CierreCajaPublicController],
  providers: [CierreCajaService, CierreCajaSchedulerService],
  exports: [CierreCajaService],
})
export class CierreCajaModule {}
