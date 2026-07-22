import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ExchangeRateSyncService } from "./exchange-rate-sync.service";

@Injectable()
export class ExchangeRateSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ExchangeRateSchedulerService.name);

  constructor(private readonly sync: ExchangeRateSyncService) {}

  /** Activo por defecto; desactivar solo con EXCHANGE_RATE_AUTO_SYNC=false */
  private get autoSyncEnabled(): boolean {
    return process.env.EXCHANGE_RATE_AUTO_SYNC !== "false";
  }

  async onModuleInit() {
    if (!this.autoSyncEnabled) {
      this.logger.log("Sync de tasas BCV automático desactivado (EXCHANGE_RATE_AUTO_SYNC=false)");
      return;
    }

    this.logger.log("Sync USD y EUR BCV automático activo — actualizando al arrancar…");
    try {
      await this.sync.syncAllOrganizations();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Sync de tasas al arrancar falló: ${message}`);
    }
  }

  /** 7:00, 12:00 y 18:00 hora Venezuela */
  @Cron(process.env.EXCHANGE_RATE_SYNC_CRON || "0 7,12,18 * * *", {
    timeZone: process.env.EXCHANGE_RATE_SYNC_TZ || "America/Caracas",
  })
  async scheduledBcvSync() {
    if (!this.autoSyncEnabled) return;

    this.logger.log("Cron: sincronización automática tasas USD y EUR BCV");
    try {
      await this.sync.syncAllOrganizations();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cron de tasas BCV falló: ${message}`);
    }
  }
}
