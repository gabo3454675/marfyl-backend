import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { CierreCajaService } from './cierre-caja.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { AperturaCajaDto } from './dto/apertura-caja.dto';
import { CierreCajaZDto } from './dto/cierre-caja-z.dto';
import { CierreCajaEstado } from '@prisma/client';

@Controller('cierre-caja')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class CierreCajaController {
  constructor(private readonly cierreCajaService: CierreCajaService) {}

  /**
   * Apertura de caja (inicio de turno). Body: { montoInicial }
   */
  @Post('apertura')
  async apertura(
    @ActiveOrganization() tenantId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: AperturaCajaDto,
  ) {
    return this.cierreCajaService.apertura(tenantId, user.id, dto);
  }

  /**
   * X-Report: estado actual del turno abierto (ventas efectivo/digital, autoconsumos).
   * No incluye monto esperado (conciliación ciega).
   */
  @Get('abierto')
  async getCierreAbierto(
    @ActiveOrganization() tenantId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.cierreCajaService.getCierreAbierto(tenantId, user.id);
  }

  /**
   * Marca el cierre como impreso (ticket Z enviado a impresora).
   */
  @Patch(':id/marcar-impreso')
  async marcarImpreso(
    @ActiveOrganization() tenantId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cierreCajaService.marcarImpreso(tenantId, id);
  }

  /**
   * Ticket térmico (58mm o 80mm) con QR al resumen digital. Query: ancho=58|80
   */
  @Get(':id/ticket')
  async getTicket(
    @ActiveOrganization() tenantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('ancho') ancho?: string,
  ) {
    const anchoMm = ancho === '80' ? 80 : 58;
    return this.cierreCajaService.getTicket(tenantId, id, anchoMm);
  }

  /**
   * Z-Report: cierra el turno. Body: { montoFisico, observaciones? }
   * Conciliación ciega: el cajero solo ingresa monto físico; el sistema calcula diferencia después.
   */
  @Post('cerrar')
  async cerrar(
    @ActiveOrganization() tenantId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: CierreCajaZDto,
  ) {
    return this.cierreCajaService.cerrar(tenantId, user.id, dto);
  }

  /**
   * Historial de cierres. Query: userId?, estado? (OPEN|CLOSED), limit?
   */
  @Get()
  async listar(
    @ActiveOrganization() tenantId: number,
    @Query('userId') userId?: string,
    @Query('estado') estado?: string,
    @Query('limit') limit?: string,
  ) {
    const opts: { userId?: number; estado?: CierreCajaEstado; limit?: number } = {};
    if (userId != null && userId !== '') {
      const n = parseInt(userId, 10);
      if (!Number.isNaN(n)) opts.userId = n;
    }
    if (estado === 'OPEN' || estado === 'CLOSED') opts.estado = estado;
    if (limit != null && limit !== '') {
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n)) opts.limit = n;
    }
    return this.cierreCajaService.listar(tenantId, opts);
  }
}
