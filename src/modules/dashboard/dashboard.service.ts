import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { DashboardSummaryDto } from "./dto/dashboard-summary.dto";
import type {
  DashboardHealthDto,
  SalesChartDayDto,
  TopProductMarginDto,
  MonthlySalesDto,
} from "./dto/dashboard-health.dto";
import type {
  DashboardDiagnosisDto,
  MarginErosionProductDto,
  DebtAgeCustomerDto,
} from "./dto/dashboard-diagnosis.dto";
import type {
  DashboardStrategyDto,
  ParetoCustomerDto,
  FrictionFunnelDto,
  StrategyInsightDto,
} from "./dto/dashboard-strategy.dto";
import { Prisma } from "@prisma/client";
import {
  productCostUsd,
  productSaleUsd,
  safeExchangeRate,
} from "@/common/helpers/currency.helper";

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  /** Facturas POS/operativas (excluye importaciones históricas FastReport). */
  private operationalPaidWhere(organizationId: number, extra?: object) {
    return {
      organizationId,
      status: "PAID" as const,
      isLegacyImport: { not: true },
      ...extra,
    };
  }

  /** Volumen de ventas (incluye legacy importado por issueDate). */
  private paidVolumeWhere(organizationId: number, extra?: object) {
    return {
      organizationId,
      status: "PAID" as const,
      deletedAt: null,
      ...extra,
    };
  }

  private startOfUtcDay(date = new Date()): Date {
    return new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
  }

  private addUtcDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  /**
   * Ganancia neta estimada en USD vía agregación SQL.
   * Solo ventas operativas; costPrice del catálogo siempre en USD.
   */
  private async aggregateNetProfitUsd(
    organizationId: number,
    from: Date,
    to: Date | undefined,
  ): Promise<number> {
    const dateToFilter = to
      ? Prisma.sql`AND i."issueDate" <= ${to}`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ profit: Prisma.Decimal | null }>
    >`
      SELECT COALESCE(SUM(
        (ii."unitPrice"::numeric * ii.quantity)
        - (p."costPrice"::numeric * ii.quantity)
      ), 0) AS profit
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii."invoiceId"
      INNER JOIN products p ON p.id = ii."productId"
      WHERE i."organizationId" = ${organizationId}
        AND i.status = 'PAID'
        AND COALESCE(i."isLegacyImport", false) = false
        AND i."issueDate" >= ${from}
        ${dateToFilter}
    `;

    return Math.round(Number(rows[0]?.profit ?? 0) * 100) / 100;
  }

  /** Costo de reposición (USD). Por defecto solo ventas operativas; opcional incluir legacy. */
  private async aggregateReplacementCostUsd(
    organizationId: number,
    from: Date,
    to?: Date,
    operationalOnly = true,
  ): Promise<number> {
    const dateToFilter = to
      ? Prisma.sql`AND i."issueDate" < ${to}`
      : Prisma.empty;
    const scopeFilter = operationalOnly
      ? Prisma.sql`AND COALESCE(i."isLegacyImport", false) = false`
      : Prisma.sql`AND i."deletedAt" IS NULL`;

    const rows = await this.prisma.$queryRaw<
      Array<{ cost: Prisma.Decimal | null }>
    >`
      SELECT COALESCE(SUM(p."costPrice"::numeric * ii.quantity), 0) AS cost
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii."invoiceId"
      INNER JOIN products p ON p.id = ii."productId"
      WHERE i."organizationId" = ${organizationId}
        AND i.status = 'PAID'
        ${scopeFilter}
        AND i."issueDate" >= ${from}
        ${dateToFilter}
    `;

    return Number(rows[0]?.cost ?? 0);
  }

  /**
   * Facturas pendientes (top 5) para widgets del dashboard.
   * Performance: take(5) obligatorio.
   */
  async getPendingInvoices(organizationId: number) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: "PENDING",
      },
      take: 5,
      orderBy: {
        createdAt: "desc",
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
      customerName: inv.customer?.name || "Cliente General",
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
        isActive: true,
        stock: { lt: threshold },
      },
      take: 5,
      orderBy: [
        { stock: "asc" }, // prioridad: más crítico primero
        { updatedAt: "desc" },
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
    const empty: DashboardSummaryDto = {
      totalSalesToday: 0,
      totalSalesYesterday: 0,
      productsCount: 0,
      lowStockCount: 0,
      recentTransactions: [],
    };

    if (!this.prisma.dbAvailable) {
      return empty;
    }

    try {
      const today = this.startOfUtcDay();
      const tomorrow = this.addUtcDays(today, 1);
      const yesterday = this.addUtcDays(today, -1);

      const [invoicesToday, invoicesYesterday] = await Promise.all([
        this.prisma.invoice.aggregate({
          where: this.paidVolumeWhere(organizationId, {
            issueDate: { gte: today, lt: tomorrow },
          }),
          _sum: { totalAmount: true },
        }),
        this.prisma.invoice.aggregate({
          where: this.paidVolumeWhere(organizationId, {
            issueDate: { gte: yesterday, lt: today },
          }),
          _sum: { totalAmount: true },
        }),
      ]);

      const totalSalesToday = invoicesToday._sum.totalAmount
        ? Number(invoicesToday._sum.totalAmount)
        : 0;
      const totalSalesYesterday = invoicesYesterday._sum.totalAmount
        ? Number(invoicesYesterday._sum.totalAmount)
        : 0;

      const productsCount = await this.prisma.product.count({
        where: { organizationId, isActive: true },
      });

      const lowStockCount = await this.prisma.product.count({
        where: {
          organizationId,
          isActive: true,
          stock: { lt: 5 },
        },
      });

      const recentInvoices = await this.prisma.invoice.findMany({
        where: this.paidVolumeWhere(organizationId),
        take: 5,
        orderBy: { issueDate: "desc" },
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
        customerName: invoice.customer?.name || "Cliente General",
        amount: Number(invoice.totalAmount),
        status: invoice.status,
        createdAt: invoice.createdAt,
      }));

      return {
        totalSalesToday,
        totalSalesYesterday,
        productsCount,
        lowStockCount,
        recentTransactions,
      };
    } catch {
      return empty;
    }
  }

  /**
   * Dashboard de Salud General: ventas $ vs Bs último mes, top 5 por margen, KPIs.
   * OPTIMIZADO: Usa aggregations en lugar de findMany para reducir transferencia de datos.
   */
  async getHealth(organizationId: number): Promise<DashboardHealthDto> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true },
    });
    const rate = safeExchangeRate(Number(org?.exchangeRate ?? 1));

    const now = new Date();
    const todayUtc = this.startOfUtcDay(now);
    const firstDayThisMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const firstDayLastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const lastDayLastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999),
    );
    const chartFrom = this.addUtcDays(todayUtc, -29);

    // Ventas últimos 30 días (incluye importación histórica por issueDate)
    const dailySalesRaw = await this.prisma.$queryRaw<
      Array<{ date: string; total: Prisma.Decimal }>
    >`
      SELECT DATE("issueDate") as date, SUM("totalAmount") as total
      FROM "invoices"
      WHERE "organizationId" = ${organizationId}
        AND status = 'PAID'
        AND "deletedAt" IS NULL
        AND "issueDate" >= ${chartFrom}
        AND "issueDate" < ${this.addUtcDays(todayUtc, 1)}
      GROUP BY DATE("issueDate")
      ORDER BY date
    `;

    const byDay = new Map<string, number>();
    for (const row of dailySalesRaw) {
      const dateStr =
        typeof row.date === "string"
          ? row.date
          : new Date(row.date).toISOString().slice(0, 10);
      byDay.set(dateStr.slice(0, 10), Number(row.total));
    }

    const salesChartLastMonth: SalesChartDayDto[] = [];
    const d = new Date(chartFrom);
    const chartEnd = this.addUtcDays(todayUtc, 1);
    while (d < chartEnd) {
      const key = d.toISOString().slice(0, 10);
      const dayUsd = byDay.get(key) ?? 0;
      salesChartLastMonth.push({
        date: key,
        ventasUsd: Math.round(dayUsd * 100) / 100,
        ventasBs: Math.round(dayUsd * rate * 100) / 100,
      });
      d.setUTCDate(d.getUTCDate() + 1);
    }

    // Top 5 productos por margen (SQL agregado, sin límite arbitrario de filas)
    const topMarginRaw = await this.prisma.$queryRaw<
      Array<{
        product_id: number;
        product_name: string;
        margin: Prisma.Decimal;
      }>
    >`
      SELECT
        p.id AS product_id,
        p.name AS product_name,
        COALESCE(SUM(
          (ii."unitPrice"::numeric * ii.quantity)
          - (p."costPrice"::numeric * ii.quantity)
        ), 0) AS margin
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii."invoiceId"
      INNER JOIN products p ON p.id = ii."productId"
      WHERE i."organizationId" = ${organizationId}
        AND i.status = 'PAID'
        AND i."deletedAt" IS NULL
        AND i."issueDate" >= ${chartFrom}
        AND i."issueDate" < ${this.addUtcDays(todayUtc, 1)}
      GROUP BY p.id, p.name
      ORDER BY margin DESC
      LIMIT 5
    `;

    const topProductsByMargin: TopProductMarginDto[] = topMarginRaw.map((row) => ({
      productId: row.product_id,
      productName: row.product_name,
      margin: Math.round(Number(row.margin) * 100) / 100,
    }));

    // KPIs: ticket promedio (mes actual), crecimiento mensual - OPTIMIZADO con aggregations
    const [invoicesThisMonthAgg, invoicesLastMonthAgg] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: this.paidVolumeWhere(organizationId, {
          issueDate: { gte: firstDayThisMonth },
        }),
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      this.prisma.invoice.aggregate({
        where: this.paidVolumeWhere(organizationId, {
          issueDate: { gte: firstDayLastMonth, lte: lastDayLastMonth },
        }),
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ]);

    const totalThisMonth = Number(invoicesThisMonthAgg._sum.totalAmount ?? 0);
    const totalLastMonth = Number(invoicesLastMonthAgg._sum.totalAmount ?? 0);
    const countThisMonth = invoicesThisMonthAgg._count.id;
    const countLastMonth = invoicesLastMonthAgg._count.id;
    const ticketPromedio =
      countThisMonth > 0 ? totalThisMonth / countThisMonth : 0;
    const ticketPromedioPrev =
      countLastMonth > 0 ? totalLastMonth / countLastMonth : 0;
    const crecimientoMensual: number =
      totalLastMonth > 0
        ? Math.round(((totalThisMonth - totalLastMonth) / totalLastMonth) * 100 * 10) / 10
        : totalThisMonth > 0
          ? 100
          : 0;

    // Meta diaria: promedio del mes anterior + 10% de stretch
    const daysInLastMonth = lastDayLastMonth.getDate();
    const avgDailyLastMonth =
      daysInLastMonth > 0 ? totalLastMonth / daysInLastMonth : 0;
    const dailySalesGoal = Math.round(avgDailyLastMonth * 1.1 * 100) / 100;

    // Ganancia neta estimada (ingresos - costos de reposición en USD), sin importaciones legacy
    const [estimatedNetProfit, estimatedNetProfitPrev, costAllSalesMonth] =
      await Promise.all([
        this.aggregateNetProfitUsd(organizationId, firstDayThisMonth, undefined),
        this.aggregateNetProfitUsd(
          organizationId,
          firstDayLastMonth,
          lastDayLastMonth,
        ),
        this.aggregateReplacementCostUsd(
          organizationId,
          firstDayThisMonth,
          this.addUtcDays(todayUtc, 1),
          false,
        ),
      ]);

      const sixMonthsAgo = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
    );
    const monthlySalesRaw = await this.prisma.$queryRaw<
      Array<{ month: string; total: Prisma.Decimal }>
    >`
      SELECT TO_CHAR("issueDate", 'YYYY-MM') as month, SUM("totalAmount") as total
      FROM "invoices"
      WHERE "organizationId" = ${organizationId}
        AND status = 'PAID'
        AND "deletedAt" IS NULL
        AND "issueDate" >= ${sixMonthsAgo}
      GROUP BY TO_CHAR("issueDate", 'YYYY-MM')
      ORDER BY month
    `;

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const monthlySalesChart = monthlySalesRaw.map((row) => {
      const [year, month] = row.month.split('-');
      const label = `${monthNames[parseInt(month, 10) - 1]} ${year}`;
      return { month: label, ventas: Math.round(Number(row.total) * 100) / 100 };
    });

    // Punto de equilibrio: Costos Fijos / Margen Promedio
    // Costos fijos = gastos operativos pagados del mes
    const expensesAgg = await this.prisma.expense.aggregate({
      where: {
        organizationId,
        status: "PAID",
        deletedAt: null,
        date: { gte: firstDayThisMonth },
        category: {
          NOT: {
            name: { contains: "inventario", mode: "insensitive" },
          },
        },
      },
      _sum: { amount: true },
    });
    const fixedCosts = Number(expensesAgg._sum.amount ?? 0);
    // Margen promedio = (ingresos - costo de reposición) / ingresos
    // Usamos totalThisMonth como proxy de ingresos (incluye IVA, aproximación aceptable)
    const avgMargin =
      totalThisMonth > 0
        ? (totalThisMonth - costAllSalesMonth) / totalThisMonth
        : 0.3;
    const breakEvenPoint =
      avgMargin > 0 ? Math.round(fixedCosts / avgMargin) : 0;

    return {
      salesChartLastMonth,
      topProductsByMargin,
      ticketPromedio: Math.round(ticketPromedio * 100) / 100,
      ticketPromedioPrev: Math.round(ticketPromedioPrev * 100) / 100,
      crecimientoMensual,
      totalVentasMes: Math.round(totalThisMonth * 100) / 100,
      dailySalesGoal,
      estimatedNetProfit,
      estimatedNetProfitPrev,
      monthlySalesChart,
      breakEvenPoint,
    };
  }

  /** Productos con erosión de margen (catálogo, precios en USD de referencia). */
  private async getMarginErosionProducts(
    organizationId: number,
    rate: number,
    limit = 25,
  ): Promise<MarginErosionProductDto[]> {
    const MARGIN_CRITICAL_PCT = 15;
    const products = await this.prisma.product.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        costPrice: true,
        salePrice: true,
        salePriceCurrency: true,
      },
    });

    return products
      .filter((p) => Number(p.salePrice) > 0)
      .map((p) => {
        const cost = productCostUsd(Number(p.costPrice));
        const saleUsd = productSaleUsd(
          Number(p.salePrice),
          p.salePriceCurrency,
          rate,
        );
        const marginPct =
          saleUsd > 0 ? ((saleUsd - cost) / saleUsd) * 100 : 0;
        return {
          productId: p.id,
          productName: p.name,
          costPrice: Math.round(cost * 100) / 100,
          salePrice: Math.round(saleUsd * 100) / 100,
          marginPct: Math.round(marginPct * 10) / 10,
          marginCritical: marginPct < MARGIN_CRITICAL_PCT,
        };
      })
      .sort((a, b) => a.marginPct - b.marginPct)
      .slice(0, limit);
  }

  /** Diagnóstico: erosión de margen (costo vs precio venta, margen &lt; 15% en rojo) y antigüedad de deuda por cliente */
  async getDiagnosis(organizationId: number): Promise<DashboardDiagnosisDto> {
    const PAYMENT_TERM_DAYS = 30;

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true },
    });
    const rate = safeExchangeRate(Number(org?.exchangeRate ?? 1));

    const marginErosion = await this.getMarginErosionProducts(
      organizationId,
      rate,
    );
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const pendingInvoices = await this.prisma.invoice.findMany({
      where: { organizationId, status: "PENDING" },
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
      {
        name: string;
        aTiempo: number;
        vencidas1_15: number;
        criticas30: number;
      }
    >();

    for (const inv of pendingInvoices) {
      const dueDate = new Date(inv.createdAt);
      dueDate.setDate(dueDate.getDate() + PAYMENT_TERM_DAYS);
      dueDate.setHours(0, 0, 0, 0);
      const daysOverdue = Math.floor(
        (today.getTime() - dueDate.getTime()) / (24 * 60 * 60 * 1000),
      );
      const amount = Number(inv.totalAmount);
      const cid = inv.customerId ?? 0;
      const name = inv.customer?.name ?? "Cliente general";

      if (!byCustomer.has(cid)) {
        byCustomer.set(cid, {
          name,
          aTiempo: 0,
          vencidas1_15: 0,
          criticas30: 0,
        });
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

    const debtAgeByCustomer: DebtAgeCustomerDto[] = Array.from(
      byCustomer.entries(),
    )
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
        ...this.paidVolumeWhere(organizationId),
        issueDate: { gte: twelveMonthsAgo },
      },
      select: {
        customerId: true,
        customer: { select: { id: true, name: true } },
        totalAmount: true,
      },
    });

    const customerMap = new Map<
      number,
      { name: string; volume: number; frequency: number }
    >();
    for (const inv of invoicesForPareto) {
      const cid = inv.customerId ?? 0;
      const name = inv.customer?.name ?? "Cliente general";
      const amt = Number(inv.totalAmount);
      if (!customerMap.has(cid)) {
        customerMap.set(cid, { name, volume: 0, frequency: 0 });
      }
      const row = customerMap.get(cid)!;
      row.volume += amt;
      row.frequency += 1;
    }

    const volumes = Array.from(customerMap.values())
      .map((r) => r.volume)
      .filter((v) => v > 0);
    const frequencies = Array.from(customerMap.values()).map(
      (r) => r.frequency,
    );
    const medVol = this.median(volumes) || 0;
    const medFreq = this.median(frequencies) || 0;

    const paretoCustomers: ParetoCustomerDto[] = Array.from(
      customerMap.entries(),
    )
      .filter(([, r]) => r.volume > 0)
      .map(([customerId, r]) => {
        let segment: ParetoCustomerDto["segment"] = "En Riesgo";
        if (r.volume >= medVol && r.frequency >= medFreq) segment = "Leales";
        else if (r.frequency >= medFreq && r.volume < medVol)
          segment = "Transaccionales";
        return {
          customerId,
          customerName: r.name,
          volume: Math.round(r.volume * 100) / 100,
          frequency: r.frequency,
          segment,
        };
      })
      .sort((a, b) => b.volume - a.volume);

    // --- Embudo de fricción: tiempo desde creación hasta pago (PAID, últimos 90 días)
    const frictionSince = new Date();
    frictionSince.setDate(frictionSince.getDate() - 90);
    const paidInvoices = await this.prisma.invoice.findMany({
      where: {
        ...this.paidVolumeWhere(organizationId),
        issueDate: { gte: frictionSince },
      },
      select: { createdAt: true, updatedAt: true, markedAsPaidAt: true, issueDate: true },
    });

    const timesMs: number[] = [];
    for (const inv of paidInvoices) {
      const paidAt = inv.markedAsPaidAt ?? inv.updatedAt;
      timesMs.push(paidAt.getTime() - inv.issueDate.getTime());
    }
    const avgMs =
      timesMs.length > 0
        ? timesMs.reduce((a, b) => a + b, 0) / timesMs.length
        : 0;
    const tiempoPromedioHoras =
      Math.round((avgMs / (1000 * 60 * 60)) * 10) / 10;
    const tiempoPromedioDias =
      Math.round((avgMs / (1000 * 60 * 60 * 24)) * 10) / 10;

    const totalCreadas = await this.prisma.invoice.count({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: ["PENDING", "PAID"] },
        issueDate: { gte: frictionSince },
      },
    });
    const totalPagadas = await this.prisma.invoice.count({
      where: {
        ...this.paidVolumeWhere(organizationId),
        issueDate: { gte: frictionSince },
      },
    });

    let cuelloDeBotella: FrictionFunnelDto["cuelloDeBotella"] = null;
    let mensajeAlerta: string | null = null;
    const avgDays = avgMs / (1000 * 60 * 60 * 24);
    if (timesMs.length > 0 && avgDays > 7) {
      cuelloDeBotella = "cobranza";
      mensajeAlerta =
        "El tiempo promedio de cobro es alto. Revisa el seguimiento de cobranza para mejorar liquidez.";
    } else if (timesMs.length > 0 && avgDays > 3 && avgDays <= 7) {
      cuelloDeBotella = "despacho";
      mensajeAlerta =
        "El tiempo entre creación y pago sugiere fricción operativa. Verifica despacho y entrega.";
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

    // Productos con margen bajo (erosión) — consulta ligera, sin repetir getDiagnosis completo
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { exchangeRate: true },
    });
    const rate = safeExchangeRate(Number(org?.exchangeRate ?? 1));
    const lowMarginProducts = (
      await this.getMarginErosionProducts(organizationId, rate, 25)
    ).filter((p) => p.marginCritical);
    for (const p of lowMarginProducts.slice(0, 3)) {
      insights.push({
        tipo: "producto_margen",
        texto: `Tu producto "${p.productName}" se vende mucho pero tu margen es bajo (${p.marginPct}%). Considera revisar su precio.`,
        entidad: p.productName,
      });
    }

    // Cuello de botella
    if (mensajeAlerta) {
      insights.push({
        tipo: "cuello_botella",
        texto: mensajeAlerta,
      });
    }

    // Clientes en riesgo (bajo frecuencia / bajo volumen)
    const enRiesgo = paretoCustomers
      .filter((c) => c.segment === "En Riesgo")
      .slice(0, 2);
    for (const c of enRiesgo) {
      insights.push({
        tipo: "cliente_riesgo",
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
    return sorted.length % 2 !== 0
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
}
