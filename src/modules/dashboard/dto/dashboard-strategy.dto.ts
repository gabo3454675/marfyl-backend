/** Cliente clasificado en cuadrante Pareto: volumen de compra + frecuencia → etiqueta */
export class ParetoCustomerDto {
  customerId: number;
  customerName: string;
  volume: number; // Monto total comprado (últimos 12 meses)
  frequency: number; // Cantidad de compras (facturas)
  segment: 'Leales' | 'En Riesgo' | 'Transaccionales';
}

/** Embudo de fricción: tiempo desde creación hasta pago */
export class FrictionFunnelDto {
  totalCreadas: number; // Facturas creadas (PENDING + PAID en período)
  totalPagadas: number;
  tiempoPromedioHoras: number;
  tiempoPromedioDias: number;
  cuelloDeBotella: 'cobranza' | 'despacho' | null; // null si no aplica alerta
  mensajeAlerta: string | null;
}

/** Insight en lenguaje natural */
export class StrategyInsightDto {
  tipo: 'producto_margen' | 'cliente_riesgo' | 'cuello_botella';
  texto: string;
  entidad?: string; // nombre producto o cliente
}

export class DashboardStrategyDto {
  paretoCustomers: ParetoCustomerDto[];
  frictionFunnel: FrictionFunnelDto;
  insights: StrategyInsightDto[];
}
