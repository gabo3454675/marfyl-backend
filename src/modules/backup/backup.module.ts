import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';
import { BackupSchedulerService } from './backup-scheduler.service';

/**
 * Módulo opcional de backup a S3. No es requerido para el arranque de la app.
 * Dashboard, gráficos (health, diagnosis, strategy) y el resto del sistema
 * no dependen de que Backup esté listo ni de que S3 esté configurado.
 */
@Module({
  imports: [ConfigModule],
  controllers: [BackupController],
  providers: [BackupService, BackupSchedulerService],
  exports: [BackupService],
})
export class BackupModule {}
