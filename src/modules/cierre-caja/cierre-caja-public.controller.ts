import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { CierreCajaService } from './cierre-caja.service';

/**
 * Rutas públicas del cierre de caja (resumen por token para QR).
 * No requieren autenticación.
 */
@Controller('cierre-caja')
export class CierreCajaPublicController {
  constructor(private readonly cierreCajaService: CierreCajaService) {}

  /**
   * Resumen de un cierre por token (para el enlace del QR). Público.
   */
  @Public()
  @Get('resumen/:token')
  async resumenByToken(@Param('token') token: string) {
    const resumen = await this.cierreCajaService.resumenByToken(token);
    if (!resumen) {
      return { ok: false, message: 'Cierre no encontrado o enlace inválido.' };
    }
    return { ok: true, data: resumen };
  }
}
