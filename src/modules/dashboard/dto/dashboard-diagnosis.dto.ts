/** Punto del gráfico de erosión de margen: costo vs precio venta; margen &lt; 15% se resalta en rojo */
export class MarginErosionProductDto {
  productId: number;
  productName: string;
  costPrice: number;
  salePrice: number;
  marginPct: number;
  marginCritical: boolean; // true si margen < 15%
}

/** Cuentas por cobrar clasificadas por antigüedad para barras apiladas */
export class DebtAgeCustomerDto {
  customerId: number;
  customerName: string;
  aTiempo: number; // Monto no vencido (a tiempo)
  vencidas1_15: number; // Vencidas 1-15 días
  criticas30: number; // Críticas +30 días (incluye 16-29 y 30+)
}

export class DashboardDiagnosisDto {
  marginErosion: MarginErosionProductDto[];
  debtAgeByCustomer: DebtAgeCustomerDto[];
}
