import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';
import { DashboardSummaryDto } from './dto/dashboard-summary.dto';
import type {
  DashboardHealthDto,
  SalesChartDayDto,
  TopProductMarginDto,
} from './dto/dashboard-health.dto';
import type {
  DashboardDiagnosisDto,
  MarginErosionProductDto,
  DebtAgeCustomerDto,
} from './dto/dashboard-diagnosis.dto';
import type {
  DashboardStrategyDto,
  ParetoCustomerDto,
  FrictionFunnelDto,
  StrategyInsightDto,
} from './dto/dashboard-strategy.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /**
   * Facturas pendientes (top 5) para widgets del dashboard.
   * Performance: take(5) obligatorio.
   */
  async getPendingInvoices(organizationId: number) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: 'PENDING',
      },
      take: 5,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        customer: {
          select: { name: true },
        },
      },
    });

    return invoices.map((inv) => ({
      id: inv.id,
      status: inv.status,
      createdAt: inv.createdAt,
      totalAmount: Number(inv.totalAmount),
      customerName: inv.customer?.name || 'Cliente General',
    }));
  }

  /**
   * Productos con stock bajo (top 5) para widgets del dashboard.
   * Performance: take(5) obligatorio.
   *
   * Nota: para que Prisma pueda filtrar en DB sin traer todo, usamos umbral fijo (< 5)
   * alineado con el requerimiento UX del dashboard.
   */
  async getLowStock(organizationId: number, threshold: number = 5) {
    const products = await this.prisma.product.findMany({
      where: {
        organizationId,
        stock: { lt: threshold },
      },
      take: 5,
      orderBy: [
        { stock: 'asc' }, // prioridad: más crítico primero
        { updatedAt: 'desc' },
      ],
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        minStock: true,
        updatedAt: true,
      },
    });

    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      stock: p.stock,
      minStock: p.minStock ?? 5,
      updatedAt: p.updatedAt,
    }));
  }

  async getSummary(organizationId: number): Promise<DashboardSummaryDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Suma de ventas del día (solo facturas pagadas)
    const invoicesToday = await this.prisma.invoice.aggregate({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
        createdAt: {
          gte: today,
          lt: tomorrow,
        },
        status: 'PAID',
      },
      _sum: {
        totalAmount: true,
      },
    });

    const totalSalesToday = invoicesToday._sum.totalAmount
      ? Number(invoicesToday._sum.totalAmount)
      : 0;

    // Conteo total de productos
    const productsCount = await this.prisma.product.count({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
    });

    // Productos con stock bajo (conteo)
    // Performance: conteo directo por umbral fijo para evitar traer todo a memoria.
    const lowStockCount = await this.prisma.product.count({
      where: {
        organizationId,
        stock: { lt: 5 },
      },
    });

    // Últimas 5 facturas
    const recentInvoices = await this.prisma.invoice.findMany({
      where: {
        organizationId, // OBLIGATORIO: Filtro por organización para aislamiento multi-tenant
      },
      take: 5,
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        customer: {
          select: {
            name: true,
          },
        },
      },
    });

    const recentTransactions = recentInvoices.map((invoice) => ({
      id: invoice.id,
      customerName: invoice.customer?.name || 'Cliente General',
      amount: Number(invoice.totalAmount),
      status: invoice.status,
      createdAt: invoice.createdAt,
    }));

    return {
      totalSalesToday,
      productsCount,
      lowStockCount,
      recentTransactions,
    };
  }

  /**
   * Dashboard de Salud General: ventas $ vs Bs último mes, top 5 por margen, KPIs.
   */
  async getHealth(organizationId: number): Promise<DashboardHealthDto> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true },
    });
    const rate = org?.exchangeRate ?? 1;

    const now = new Date();
    const firstDayThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // Ventas último mes por día (solo PAID)
    const invoicesLastMonth = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: 'PAID',
        createdAt: { gte: firstDayLastMonth, lte: lastDayLastMonth },
      },
      select: { createdAt: true, totalAmount: true },
    });

    const byDay = new Map<string, { usd: number }>();
    for (const inv of invoicesLastMonth) {
      const key = inv.createdAt.toISOString().slice(0, 10);
      const current = byDay.get(key) ?? { usd: 0 };
      current.usd += Number(inv.totalAmount);
      byDay.set(key, current);
    }

    const salesChartLastMonth: SalesChartDayDto[] = [];
    const d = new Date(firstDayLastMonth);
    while (d <= lastDayLastMonth) {
      const key = d.toISOString().slice(0, 10);
      const dayData = byDay.get(key) ?? { usd: 0 };
      salesChartLastMonth.push({
        date: key,
        ventasUsd: Math.round(dayData.usd * 100) / 100,
        ventasBs: Math.round(dayData.usd * rate * 100) / 100,
      });
      d.setDate(d.getDate() + 1);
    }

    // Top 5 productos por margen (ganancia neta): (unitPrice - costPrice) * quantity
    const itemsWithProduct = await this.prisma.invoiceItem.findMany({
      where: {
        invoice: {
          organizationId,
          status: 'PAID',
          createdAt: { gte: firstDayLastMonth, lte: lastDayLastMonth },
        },
      },
      include: {
        product: { select: { id: true, name: true, costPrice: true } },
      },
    });

    const marginByProduct = new Map<number, { name: string; margin: number }>();
    for (const item of itemsWithProduct) {
      const cost = Number(item.product.costPrice);
      const revenue = Number(item.unitPrice);
      const margin = (revenue - cost) * item.quantity;
      const existing = marginByProduct.get(item.productId);
      if (existing) {
        existing.margin += margin;
      } else {
        marginByProduct.set(item.productId, { name: item.product.name, margin });
      }
    }

    const topProductsByMargin: TopProductMarginDto[] = Array.from(marginByProduct.entries())
      .map(([productId, { name, margin }]) => ({ productId, productName: name, margin }))
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 5);

    // KPIs: ticket promedio (mes actual), crecimiento mensual, impuestos acumulados
    const [invoicesThisMonth, invoicesLastMonthAgg] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organizationId,
          status: 'PAID',
          createdAt: { gte: firstDayThisMonth },
        },
        select: { totalAmount: true },
      }),
      this.prisma.invoice.aggregate({
        where: {
          organizationId,
          status: 'PAID',
          createdAt: { gte: firstDayLastMonth, lte: lastDayLastMonth },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ]);

    const totalThisMonth = invoicesThisMonth.reduce((s, i) => s + Number(i.totalAmount), 0);
    const totalLastMonth = Number(invoicesLastMonthAgg._sum.totalAmount ?? 0);
    const countThisMonth = invoicesThisMonth.length;
    const ticketPromedio = countThisMonth > 0 ? totalThisMonth / countThisMonth : 0;
    const crecimientoMensual =
      totalLastMonth > 0 ? ((totalThisMonth - totalLastMonth) / totalLastMonth) * 100 : 0;

    return {
      salesChartLastMonth,
      topProductsByMargin,
      ticketPromedio: Math.round(ticketPromedio * 100) / 100,
      crecimientoMensual: Math.round(crecimientoMensual * 10) / 10,
      totalVentasMes: Math.round(totalThisMonth * 100) / 100,
    };
  }

  /** Diagnóstico: erosión de margen (costo vs precio venta, margen &lt; 15% en rojo) y antigüedad de deuda por cliente */
  async getDiagnosis(organizationId: number): Promise<DashboardDiagnosisDto> {
    const MARGIN_CRITICAL_PCT = 15;
    const PAYMENT_TERM_DAYS = 30;

    // --- Erosión de margen: productos con costPrice y salePrice; margen % y flag critical
    const products = await this.prisma.product.findMany({
      where: { organizationId },
      select: { id: true, name: true, costPrice: true, salePrice: true },
    });

    const marginErosion: MarginErosionProductDto[] = products
      .filter((p) => Number(p.salePrice) > 0)
      .map((p) => {
        const cost = Number(p.costPrice);
        const sale = Number(p.salePrice);
        const marginPct = sale > 0 ? ((sale - cost) / sale) * 100 : 0;
        return {
          productId: p.id,
          productName: p.name,
          costPrice: Math.round(cost * 100) / 100,
          salePrice: Math.round(sale * 100) / 100,
          marginPct: Math.round(marginPct * 10) / 10,
          marginCritical: marginPct < MARGIN_CRITICAL_PCT,
        };
      })
      .sort((a, b) => a.marginPct - b.marginPct) // Más críticos primero
      .slice(0, 25); // Top 25 para el gráfico

    // --- Antigüedad de deuda: facturas PENDING por cliente, clasificadas en A tiempo / 1-15 / +30
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingInvoices = await this.prisma.invoice.findMany({
      where: { organizationId, status: 'PENDING' },
      select: {
        id: true,
        customerId: true,
        totalAmount: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
    });

    const byCustomer = new Map<
      number,
      { name: string; aTiempo: number; vencidas1_15: number; criticas30: number }
    >();

    for (const inv of pendingInvoices) {
      const dueDate = new Date(inv.createdAt);
      dueDate.setDate(dueDate.getDate() + PAYMENT_TERM_DAYS);
      dueDate.setHours(0, 0, 0, 0);
      const daysOverdue = Math.floor(
        (today.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      const amount = Number(inv.totalAmount);
      const cid = inv.customerId ?? 0;
      const name = inv.customer?.name ?? 'Cliente general';

      if (!byCustomer.has(cid)) {
        byCustomer.set(cid, { name, aTiempo: 0, vencidas1_15: 0, criticas30: 0 });
      }
      const row = byCustomer.get(cid)!;

      if (daysOverdue <= 0) {
        row.aTiempo += amount;
      } else if (daysOverdue <= 15) {
        row.vencidas1_15 += amount;
      } else {
        row.criticas30 += amount;
      }
    }

    const debtAgeByCustomer: DebtAgeCustomerDto[] = Array.from(byCustomer.entries())
      .map(([customerId, row]) => ({
        customerId,
        customerName: row.name,
        aTiempo: Math.round(row.aTiempo * 100) / 100,
        vencidas1_15: Math.round(row.vencidas1_15 * 100) / 100,
        criticas30: Math.round(row.criticas30 * 100) / 100,
      }))
      .filter((c) => c.aTiempo > 0 || c.vencidas1_15 > 0 || c.criticas30 > 0)
      .sort((a, b) => {
        const totalA = a.aTiempo + a.vencidas1_15 + a.criticas30;
        const totalB = b.aTiempo + b.vencidas1_15 + b.criticas30;
        return totalB - totalA;
      });

    return { marginErosion, debtAgeByCustomer };
  }

  /**
   * Estrategia: Pareto 80/20 (clientes), embudo de fricción (tiempo creación→pago), insights en lenguaje natural.
   */
  async getStrategy(organizationId: number): Promise<DashboardStrategyDto> {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, 1);

    // --- Pareto: clientes con volumen y frecuencia (últimos 12 meses, PAID)
    const invoicesForPareto = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: 'PAID',
        createdAt: { gte: twelveMonthsAgo },
      },
      select: { customerId: true, customer: { select: { id: true, name: true } }, totalAmount: true },
    });

    const customerMap = new Map<
      number,
      { name: string; volume: number; frequency: number }
    >();
    for (const inv of invoicesForPareto) {
      const cid = inv.customerId ?? 0;
      const name = inv.customer?.name ?? 'Cliente general';
      const amt = Number(inv.totalAmount);
      if (!customerMap.has(cid)) {
        customerMap.set(cid, { name, volume: 0, frequency: 0 });
      }
      const row = customerMap.get(cid)!;
      row.volume += amt;
      row.frequency += 1;
    }

    const volumes = Array.from(customerMap.values()).map((r) => r.volume).filter((v) => v > 0);
    const frequencies = Array.from(customerMap.values()).map((r) => r.frequency);
    const medVol = this.median(volumes) || 0;
    const medFreq = this.median(frequencies) || 0;

    const paretoCustomers: ParetoCustomerDto[] = Array.from(customerMap.entries())
      .filter(([, r]) => r.volume > 0)
      .map(([customerId, r]) => {
        let segment: ParetoCustomerDto['segment'] = 'En Riesgo';
        if (r.volume >= medVol && r.frequency >= medFreq) segment = 'Leales';
        else if (r.frequency >= medFreq && r.volume < medVol) segment = 'Transaccionales';
        return {
          customerId,
          customerName: r.name,
          volume: Math.round(r.volume * 100) / 100,
          frequency: r.frequency,
          segment,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    // --- Embudo de fricción: tiempo desde creación hasta pago (PAID)
    const paidInvoices = await this.prisma.invoice.findMany({
      where: { organizationId, status: 'PAID' },
      select: { createdAt: true, updatedAt: true, markedAsPaidAt: true },
    });

    const timesMs: number[] = [];
    for (const inv of paidInvoices) {
      const paidAt = inv.markedAsPaidAt ?? inv.updatedAt;
      timesMs.push(paidAt.getTime() - inv.createdAt.getTime());
    }
    const avgMs = timesMs.length > 0 ? timesMs.reduce((a, b) => a + b, 0) / timesMs.length : 0;
    const tiempoPromedioHoras = Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10;
    const tiempoPromedioDias = Math.round((avgMs / (1000 * 60 * 60 * 24)) * 10) / 10;

    const totalCreadas = await this.prisma.invoice.count({
      where: { organizationId, status: { in: ['PENDING', 'PAID'] } },
    });
    const totalPagadas = await this.prisma.invoice.count({
      where: { organizationId, status: 'PAID' },
    });

    let cuelloDeBotella: FrictionFunnelDto['cuelloDeBotella'] = null;
    let mensajeAlerta: string | null = null;
    const avgDays = avgMs / (1000 * 60 * 60 * 24);
    if (timesMs.length > 0 && avgDays > 7) {
      cuelloDeBotella = 'cobranza';
      mensajeAlerta =
        'El tiempo promedio de cobro es alto. Revisa el seguimiento de cobranza para mejorar liquidez.';
    } else if (timesMs.length > 0 && avgDays > 3 && avgDays <= 7) {
      cuelloDeBotella = 'despacho';
      mensajeAlerta =
        'El tiempo entre creación y pago sugiere fricción operativa. Verifica despacho y entrega.';
    }

    const frictionFunnel: FrictionFunnelDto = {
      totalCreadas,
      totalPagadas,
      tiempoPromedioHoras,
      tiempoPromedioDias,
      cuelloDeBotella,
      mensajeAlerta,
    };

    // --- Insights en lenguaje natural
    const insights: StrategyInsightDto[] = [];

    // Productos con margen bajo (erosión)
    const erosion = await this.getDiagnosis(organizationId);
    const lowMarginProducts = erosion.marginErosion.filter((p) => p.marginCritical);
    for (const p of lowMarginProducts.slice(0, 3)) {
      insights.push({
        tipo: 'producto_margen',
        texto: `Tu producto "${p.productName}" se vende mucho pero tu margen es bajo (${p.marginPct}%). Considera revisar su precio.`,
        entidad: p.productName,
      });
    }

    // Cuello de botella
    if (mensajeAlerta) {
      insights.push({
        tipo: 'cuello_botella',
        texto: mensajeAlerta,
      });
    }

    // Clientes en riesgo (bajo frecuencia / bajo volumen)
    const enRiesgo = paretoCustomers.filter((c) => c.segment === 'En Riesgo').slice(0, 2);
    for (const c of enRiesgo) {
      insights.push({
        tipo: 'cliente_riesgo',
        texto: `${c.customerName} tiene bajo volumen o poca frecuencia de compra. Considera ofertas o seguimiento para recuperar ventas.`,
        entidad: c.customerName,
      });
    }

    return { paretoCustomers, frictionFunnel, insights };
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
}
