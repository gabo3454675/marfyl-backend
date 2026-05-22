import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BackupService } from './backup.service';

@Injectable()
export class BackupSchedulerService {
  private readonly logger = new Logger(BackupSchedulerService.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Backup diario a las 02:00 (hora del servidor).
   * Solo ejecuta si ENABLE_SCHEDULED_BACKUPS es 'true'.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async handleDailyBackup() {
    const enableScheduled = this.configService.get<string>('ENABLE_SCHEDULED_BACKUPS');
    if (enableScheduled !== 'true') {
      this.logger.log('Backup deshabilitado temporalmente (ENABLE_SCHEDULED_BACKUPS no es "true")');
      return;
    }

    this.logger.log('Ejecutando backup diario programado...');
    try {
      const result = await this.backupService.runBackup();
      if (result.skipped) {
        this.logger.log('Backup diario no ejecutado (backup deshabilitado).');
        return;
      }
      this.logger.log(
        result.s3Url
          ? `Backup diario completado. S3: ${result.s3Url}`
          : 'Backup diario completado (solo local, S3 no configurado)',
      );
    } catch (error) {
      this.logger.error('Error en backup diario', error instanceof Error ? error.stack : String(error));
    }
  }
}
