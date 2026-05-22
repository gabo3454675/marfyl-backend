import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';
import { PushNotificationService } from '@/modules/notifications/push-notification.service';
import { CierreCajaEstado } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type { AperturaCajaDto } from './dto/apertura-caja.dto';
import type { CierreCajaZDto } from './dto/cierre-caja-z.dto';

@Injectable()
export class CierreCajaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pushNotification: PushNotificationService,
  ) {}

  /**
   * Apertura de caja (inicio de turno). Un solo turno OPEN por usuario y tenant.
   */
  async apertura(tenantId: number, userId: number, dto: AperturaCajaDto) {
    const existente = await this.prisma.cierreCaja.findFirst({
      where: {
        tenantId,
        userId,
        estado: 'OPEN',
      },
    });
    if (existente) {
      throw new BadRequestException(
        'Ya tienes un turno abierto. Realiza el cierre (Z-Report) antes de abrir otro.',
      );
    }

    const ahora = new Date();
    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { exchangeRate: true },
    });
    const tasa = await this.prisma.tasaHistorica.create({
      data: {
        organizationId: tenantId,
        rate: Number(org?.exchangeRate ?? 1),
        source: 'BCV',
        effectiveAt: ahora,
      },
    });
    return this.prisma.cierreCaja.create({
      data: {
        tenantId,
        userId,
        fechaApertura: ahora,
        fechaCierre: ahora,
        montoInicial: dto.montoInicial,
        ventasEfectivo: 0,
        ventasDigitales: 0,
        ventasEfectivoUsd: 0,
        ventasEfectivoBs: 0,
        ventasPagoMovil: 0,
        ventasPos: 0,
        autoconsumos: 0,
        estado: CierreCajaEstado.OPEN,
        tasaHistoricaId: tasa.id,
      },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  /**
   * Obtiene el cierre abierto del usuario en el tenant (X-Report: datos actuales del turno).
   * Calcula ventas efectivo, digital y autoconsumos desde fechaApertura.
   */
  async getCierreAbierto(tenantId: number, userId: number) {
    const cierre = await this.prisma.cierreCaja.findFirst({
      where: {
        tenantId,
        userId,
        estado: 'OPEN',
      },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!cierre) return null;

    const desglose = await this.calcularMontosTurno(
      tenantId,
      userId,
      cierre.fechaApertura,
      new Date(),
    );

    const ventasEfectivoUsd = Number(cierre.ventasEfectivoUsd ?? 0) + desglose.ventasEfectivoUsd;
    const ventasEfectivoBs = Number(cierre.ventasEfectivoBs ?? 0) + desglose.ventasEfectivoBs;
    const ventasPagoMovil = Number(cierre.ventasPagoMovil ?? 0) + desglose.ventasPagoMovil;
    const ventasPos = Number(cierre.ventasPos ?? 0) + desglose.ventasPos;
    const autoconsumosTotal = Number(cierre.autoconsumos) + desglose.autoconsumos;
    const ventasEfectivoTotal = ventasEfectivoUsd;
    const ventasDigitalesTotal = ventasEfectivoBs + ventasPagoMovil + ventasPos;

    return {
      ...cierre,
      ventasEfectivo: ventasEfectivoTotal,
      ventasDigitales: ventasDigitalesTotal,
      ventasEfectivoUsd,
      ventasEfectivoBs,
      ventasPagoMovil,
      ventasPos,
      autoconsumos: autoconsumosTotal,
      notaAutoconsumos: 'Salida no monetaria (mermas, muestras). No suma al efectivo.',
    };
  }

  /**
   * Cierra el turno (Z-Report): concilia monto esperado vs monto físico reportado por el cajero.
   */
  async cerrar(tenantId: number, userId: number, dto: CierreCajaZDto) {
    const cierre = await this.prisma.cierreCaja.findFirst({
      where: {
        tenantId,
        userId,
        estado: 'OPEN',
      },
    });
    if (!cierre) {
      throw new NotFoundException(
        'No tienes un turno abierto. Realiza una apertura de caja primero.',
      );
    }

    const ahora = new Date();
    const desglose = await this.calcularMontosTurno(
      tenantId,
      userId,
      cierre.fechaApertura,
      ahora,
    );

    const montoInicial = Number(cierre.montoInicial);
    const ventasEfectivoUsd = Number(cierre.ventasEfectivoUsd ?? 0) + desglose.ventasEfectivoUsd;
    const ventasEfectivoBs = Number(cierre.ventasEfectivoBs ?? 0) + desglose.ventasEfectivoBs;
    const ventasPagoMovil = Number(cierre.ventasPagoMovil ?? 0) + desglose.ventasPagoMovil;
    const ventasPos = Number(cierre.ventasPos ?? 0) + desglose.ventasPos;
    const autoconsumosTotal = Number(cierre.autoconsumos) + desglose.autoconsumos;
    const ventasEfectivoTotal = ventasEfectivoUsd;
    const ventasDigitalesTotal = ventasEfectivoBs + ventasPagoMovil + ventasPos;
    const totalUsd = montoInicial + ventasEfectivoUsd;
    const totalVes = ventasEfectivoBs + ventasPagoMovil;
    const montoFisicoUsd = dto.montoFisicoUsd ?? dto.montoFisico ?? 0;
    const montoFisicoVes = dto.montoFisicoVes ?? 0;
    const montoEsperado = totalUsd;
    const diferencia = montoEsperado - montoFisicoUsd;
    const diferenciaUsd = totalUsd - montoFisicoUsd;
    const diferenciaVes = totalVes - montoFisicoVes;
    const publicToken = uuidv4();

    const org = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { exchangeRate: true },
    });
    const tasa = await this.prisma.tasaHistorica.create({
      data: {
        organizationId: tenantId,
        rate: Number(org?.exchangeRate ?? 1),
        source: 'BCV',
        effectiveAt: ahora,
      },
    });

    const actualizado = await this.prisma.cierreCaja.update({
      where: { id: cierre.id },
      data: {
        fechaCierre: ahora,
        ventasEfectivo: ventasEfectivoTotal,
        ventasDigitales: ventasDigitalesTotal,
        ventasEfectivoUsd,
        ventasEfectivoBs,
        ventasPagoMovil,
        ventasPos,
        autoconsumos: autoconsumosTotal,
        montoFisico: montoFisicoUsd,
        montoFisicoUsd,
        montoFisicoVes,
        diferencia,
        totalUsd,
        totalVes,
        diferenciaUsd,
        diferenciaVes,
        impreso: false,
        observaciones: dto.observaciones ?? null,
        estado: CierreCajaEstado.CLOSED,
        publicToken,
        tasaHistoricaId: tasa.id,
      },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        tenant: { select: { id: true, nombre: true } },
      },
    });

    if (diferencia < -5) {
      this.pushNotification
        .notifyCierreFaltante({
          organizationName: (actualizado.tenant as { nombre?: string })?.nombre ?? 'Organización',
          cajero: (actualizado.user as { fullName?: string; email?: string })?.fullName ?? (actualizado.user as { email?: string })?.email ?? 'Cajero',
          diferencia,
          cierreId: actualizado.id,
        })
        .catch(() => {});
    }

    return {
      ...actualizado,
      montoEsperado,
      notaAutoconsumos: 'Salida no monetaria (mermas, muestras). No suma al efectivo.',
    };
  }

  /**
   * Cierre automático (fin de día): concilia monto físico = esperado según ventas del turno.
   * Usado por el programador a las 23:50 (America/Caracas).
   */
  async cerrarAutomaticoFinDia(tenantId: number, userId: number) {
    const cierre = await this.prisma.cierreCaja.findFirst({
      where: {
        tenantId,
        userId,
        estado: 'OPEN',
      },
    });
    if (!cierre) {
      return null;
    }

    const ahora = new Date();
    const desglose = await this.calcularMontosTurno(
      tenantId,
      userId,
      cierre.fechaApertura,
      ahora,
    );

    const montoInicial = Number(cierre.montoInicial);
    const ventasEfectivoUsd = Number(cierre.ventasEfectivoUsd ?? 0) + desglose.ventasEfectivoUsd;
    const ventasEfectivoBs = Number(cierre.ventasEfectivoBs ?? 0) + desglose.ventasEfectivoBs;
    const ventasPagoMovil = Number(cierre.ventasPagoMovil ?? 0) + desglose.ventasPagoMovil;
    const totalUsd = montoInicial + ventasEfectivoUsd;
    const totalVes = ventasEfectivoBs + ventasPagoMovil;

    return this.cerrar(tenantId, userId, {
      montoFisicoUsd: totalUsd,
      montoFisicoVes: totalVes,
      observaciones:
        'Cierre automático del sistema (23:50, hora Caracas). Monto físico declarado = total esperado según ventas registradas.',
    });
  }

  /**
   * Resumen público por token (para QR). Sin autenticación.
   */
  async resumenByToken(token: string) {
    const cierre = await this.prisma.cierreCaja.findFirst({
      where: { publicToken: token, estado: 'CLOSED' },
      include: {
        user: { select: { fullName: true, email: true } },
        tenant: { select: { nombre: true } },
      },
    });
    if (!cierre) return null;
    const montoEsperado =
      Number(cierre.montoInicial) + Number(cierre.ventasEfectivo);
    return {
      id: cierre.id,
      tenantNombre: cierre.tenant.nombre,
      cajero: cierre.user.fullName || cierre.user.email,
      fechaApertura: cierre.fechaApertura,
      fechaCierre: cierre.fechaCierre,
      montoInicial: Number(cierre.montoInicial),
      ventasEfectivo: Number(cierre.ventasEfectivo),
      ventasDigitales: Number(cierre.ventasDigitales),
      ventasEfectivoUsd: Number(cierre.ventasEfectivoUsd ?? cierre.ventasEfectivo ?? 0),
      ventasEfectivoBs: Number(cierre.ventasEfectivoBs ?? 0),
      ventasPagoMovil: Number(cierre.ventasPagoMovil ?? 0),
      ventasPos: Number(cierre.ventasPos ?? 0),
      autoconsumos: Number(cierre.autoconsumos),
      notaAutoconsumos: 'Salida no monetaria (mermas, muestras). No suma al efectivo.',
      montoFisico: cierre.montoFisico != null ? Number(cierre.montoFisico) : null,
      montoEsperado,
      diferencia: cierre.diferencia != null ? Number(cierre.diferencia) : null,
      totalUsd: cierre.totalUsd != null ? Number(cierre.totalUsd) : null,
      totalVes: cierre.totalVes != null ? Number(cierre.totalVes) : null,
      diferenciaUsd: cierre.diferenciaUsd != null ? Number(cierre.diferenciaUsd) : null,
      diferenciaVes: cierre.diferenciaVes != null ? Number(cierre.diferenciaVes) : null,
      impreso: cierre.impreso ?? false,
      observaciones: cierre.observaciones,
    };
  }

  /**
   * Ticket térmico (58mm o 80mm) con QR al resumen digital.
   */
  async getTicket(
    tenantId: number,
    cierreId: number,
    anchoMm: 58 | 80,
  ): Promise<{ ticketText: string; resumenUrl: string; qrDataUrl: string }> {
    const cierre = await this.prisma.cierreCaja.findFirst({
      where: { id: cierreId, tenantId, estado: 'CLOSED' },
      include: {
        user: { select: { fullName: true } },
        tenant: { select: { nombre: true } },
      },
    });
    if (!cierre || !cierre.publicToken) {
      throw new NotFoundException('Cierre no encontrado o sin token de resumen.');
    }

    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:3003');
    const resumenUrl = `${frontendUrl}/cierre/resumen/${cierre.publicToken}`;

    const qrcode = await import('qrcode');
    const qrDataUrl = await qrcode.toDataURL(resumenUrl, {
      width: 180,
      margin: 1,
    });

    const charsPerLine = anchoMm === 58 ? 32 : 48;
    const line = (s: string) => s.slice(0, charsPerLine);
    const center = (s: string) => {
      const pad = Math.max(0, Math.floor((charsPerLine - s.length) / 2));
      return (' '.repeat(pad) + s).slice(0, charsPerLine);
    };
    const fmt = (n: number) => n.toFixed(2);
    const montoEsperado = Number(cierre.montoInicial) + Number(cierre.ventasEfectivo);
    const dif = cierre.diferencia != null ? Number(cierre.diferencia) : null;
    const efectivoUsd = Number(cierre.ventasEfectivoUsd ?? cierre.ventasEfectivo ?? 0);
    const efectivoBs = Number(cierre.ventasEfectivoBs ?? 0);
    const pagoMovil = Number(cierre.ventasPagoMovil ?? 0);
    const pos = Number(cierre.ventasPos ?? 0);

    const ticketText = [
      '',
      center(cierre.tenant.nombre),
      center('CIERRE DE CAJA (Z-Report)'),
      '',
      `Cajero: ${line((cierre.user.fullName || 'N/A').slice(0, charsPerLine - 8))}`,
      `Cierre: ${new Date(cierre.fechaCierre).toLocaleString('es')}`,
      '',
      '--- CONCILIACION ---',
      `Monto inicial $    ${fmt(Number(cierre.montoInicial))}`,
      '',
      '  Efectivo $       ' + fmt(efectivoUsd),
      '  Efectivo Bs      ' + fmt(efectivoBs),
      '  Pago Movil Bs    ' + fmt(pagoMovil),
      '  POS / Zelle $    ' + fmt(pos),
      '',
      '  Salida no monet. ' + fmt(Number(cierre.autoconsumos)),
      '  (mermas/muestras)',
      '---',
      `Monto esperado $   ${fmt(montoEsperado)}`,
      `Monto fisico $     ${fmt(Number(cierre.montoFisico ?? 0))}`,
      `Diferencia         ${dif != null ? fmt(dif) : '-'}`,
      '',
      cierre.observaciones ? `Obs: ${line(cierre.observaciones)}` : '',
      '',
      center('Escanee el QR para ver'),
      center('el resumen digital'),
      '',
    ].filter(Boolean).join('\n');

    return { ticketText, resumenUrl, qrDataUrl };
  }

  /**
   * Marca el cierre como impreso (ticket Z enviado a impresora térmica).
   */
  async marcarImpreso(tenantId: number, cierreId: number) {
    const cierre = await this.prisma.cierreCaja.findFirst({
      where: { id: cierreId, tenantId, estado: 'CLOSED' },
    });
    if (!cierre) {
      throw new NotFoundException('Cierre no encontrado o no pertenece a esta organización.');
    }
    await this.prisma.cierreCaja.update({
      where: { id: cierreId },
      data: { impreso: true },
    });
    return { ok: true, impreso: true };
  }

  /**
   * Lista cierres del tenant (historial). Solo CLOSED o todos con filtro.
   */
  async listar(
    tenantId: number,
    opts?: { userId?: number; estado?: CierreCajaEstado; limit?: number },
  ) {
    const limit = Math.min(opts?.limit ?? 50, 100);
    return this.prisma.cierreCaja.findMany({
      where: {
        tenantId,
        ...(opts?.userId != null && { userId: opts.userId }),
        ...(opts?.estado != null && { estado: opts.estado }),
      },
      orderBy: { fechaCierre: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
  }

  /**
   * Calcula el desglose por moneda/método y autoconsumos (salida no monetaria) en [desde, hasta].
   */
  private async calcularMontosTurno(
    tenantId: number,
    userId: number,
    desde: Date,
    hasta: Date,
  ): Promise<{
    ventasEfectivoUsd: number;
    ventasEfectivoBs: number;
    ventasPagoMovil: number;
    ventasPos: number;
    autoconsumos: number;
  }> {
    const [invoices, expenses] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId: tenantId,
          sellerId: userId,
          status: { not: 'CANCELLED' },
          createdAt: { gte: desde, lte: hasta },
        },
        select: {
          totalAmount: true,
          paymentMethod: true,
          paymentLines: { select: { method: true, amount: true, currency: true } },
        },
      }),
      this.prisma.expense.findMany({
        where: {
          organizationId: tenantId,
          inventoryMovementId: { not: null },
          createdAt: { gte: desde, lte: hasta },
        },
        select: { amount: true },
      }),
    ]);

    let ventasEfectivoUsd = 0;
    let ventasEfectivoBs = 0;
    let ventasPagoMovil = 0;
    let ventasPos = 0;
    for (const inv of invoices) {
      if (inv.paymentLines && inv.paymentLines.length > 0) {
        for (const line of inv.paymentLines) {
          const amount = Number(line.amount);
          switch (line.method) {
            case 'CASH_USD':
              ventasEfectivoUsd += amount;
              break;
            case 'CASH_BS':
              ventasEfectivoBs += amount;
              break;
            case 'PAGO_MOVIL':
              ventasPagoMovil += amount;
              break;
            case 'ZELLE':
            case 'CARD':
            case 'CREDIT':
            default:
              ventasPos += amount;
              break;
          }
        }
      } else {
        const amount = Number(inv.totalAmount);
        if (inv.paymentMethod === 'CASH') {
          ventasEfectivoUsd += amount;
        } else {
          ventasPos += amount;
        }
      }
    }

    const autoconsumos = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    return { ventasEfectivoUsd, ventasEfectivoBs, ventasPagoMovil, ventasPos, autoconsumos };
  }
}
