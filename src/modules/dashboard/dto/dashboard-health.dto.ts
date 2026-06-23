export class SalesChartDayDto {
  date: string; // YYYY-MM-DD
  ventasUsd: number;
  ventasBs: number;
}

export class TopProductMarginDto {
  productId: number;
  productName: string;
  margin: number;
}

export class MonthlySalesDto {
  month: string; // ej. "Ene 2026"
  ventas: number;
}

export class DashboardHealthDto {
  salesChartLastMonth: SalesChartDayDto[];
  topProductsByMargin: TopProductMarginDto[];
  ticketPromedio: number;
  ticketPromedioPrev: number;
  crecimientoMensual: number; // porcentaje, ej. 12.5
  totalVentasMes: number; // Total facturado en el mes (cobro real, sin IVA/IGTF)
  dailySalesGoal: number;
  estimatedNetProfit: number;
  estimatedNetProfitPrev: number;
  monthlySalesChart: MonthlySalesDto[];
  breakEvenPoint: number;
}
