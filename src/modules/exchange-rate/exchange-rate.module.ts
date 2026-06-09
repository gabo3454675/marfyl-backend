import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { DolarApiService } from "./dolar-api.service";
import { ExchangeRateSyncService } from "./exchange-rate-sync.service";
import { ExchangeRateSchedulerService } from "./exchange-rate-scheduler.service";
import { ExchangeRateController } from "./exchange-rate.controller";
import { RolesGuard } from "@/common/guards/roles.guard";

@Module({
  imports: [PrismaModule],
  controllers: [ExchangeRateController],
  providers: [
    DolarApiService,
    ExchangeRateSyncService,
    ExchangeRateSchedulerService,
    RolesGuard,
  ],
  exports: [ExchangeRateSyncService, DolarApiService],
})
export class ExchangeRateModule {}
