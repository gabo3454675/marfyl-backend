/** Embudo de fricción: tiempo desde creación hasta pago */
export class FrictionFunnelDto {
  totalCreadas: number; // Facturas creadas (PENDING + PAID en período)
  totalPagadas: number;
  tiempoPromedioHoras: number;
  tiempoPromedioDias: number;
  cuelloDeBotella: "cobranza" | "despacho" | null; // null si no aplica alerta
  mensajeAlerta: string | null;
}

/** Insight en lenguaje natural */
export class StrategyInsightDto {
  tipo: "producto_margen" | "cuello_botella";
  texto: string;
  entidad?: string; // nombre producto o cliente
}

export class DashboardStrategyDto {
  frictionFunnel: FrictionFunnelDto;
  insights: StrategyInsightDto[];
}
