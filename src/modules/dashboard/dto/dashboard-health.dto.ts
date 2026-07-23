export class DashboardHealthDto {
  ticketPromedio: number;
  ticketPromedioPrev: number;
  crecimientoMensual: number; // porcentaje, ej. 12.5
  totalVentasMes: number; // Total facturado en el mes (cobro real, sin IVA/IGTF)
  dailySalesGoal: number;
  estimatedNetProfit: number;
  estimatedNetProfitPrev: number;
}
