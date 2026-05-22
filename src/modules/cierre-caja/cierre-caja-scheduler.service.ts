import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';
import { CierreCajaService } from './cierre-caja.service';

/**
 * Ejecuta cierre de caja (Z-Report) con conciliación al monto esperado a las 23:50 hora Caracas.
 * Desactivar con ENABLE_AUTO_CIERRE_2350=false si no se desea cierre automático.
 */
@Injectable()
export class CierreCajaSchedulerService {
  private readonly logger = new Logger(CierreCajaSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cierreCaja: CierreCajaService,
    private readonly config: ConfigService,
  ) {}

  @Cron('50 23 * * *', { timeZone: 'America/Caracas' })
  async ejecutarCierresAutomaticos() {
    const enabled = this.config.get<string>('ENABLE_AUTO_CIERRE_2350', 'true');
    if (enabled !== 'true' && enabled !== '1') {
      return;
    }

    const abiertos = await this.prisma.cierreCaja.findMany({
      where: { estado: 'OPEN' },
      select: { id: true, tenantId: true, userId: true },
    });

    for (const c of abiertos) {
      try {
        await this.cierreCaja.cerrarAutomaticoFinDia(c.tenantId, c.userId);
        this.logger.log(`Cierre automático OK: id=${c.id} tenant=${c.tenantId} user=${c.userId}`);
      } catch (e) {
        this.logger.warn(`Cierre automático falló id=${c.id}: ${e}`);
      }
    }
  }
}
