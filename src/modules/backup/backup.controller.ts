import { Controller, Post, UseGuards } from '@nestjs/common';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { ROLES } from '@/common/constants/roles.constants';

/**
 * Controlador para ejecutar backup manual (opcional).
 * El backup diario se ejecuta vía cron en BackupSchedulerService.
 */
@Controller('backup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.SUPER_ADMIN)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post('run')
  async runBackup() {
    return this.backupService.runBackup();
  }
}
