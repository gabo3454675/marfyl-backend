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

export class DashboardHealthDto {
  salesChartLastMonth: SalesChartDayDto[];
  topProductsByMargin: TopProductMarginDto[];
  ticketPromedio: number;
  crecimientoMensual: number; // porcentaje, ej. 12.5
  totalVentasMes: number; // Total facturado en el mes (cobro real, sin IVA/IGTF)
}
