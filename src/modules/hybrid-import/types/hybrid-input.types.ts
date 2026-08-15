/**
 * Representa una venta individual del listado GET /hybrid/ventas.
 * Campos según contrato Hybrid Local API v0.4.0.
 */
export interface HybridVentaInput {
  documento: string;
  fecha: string;
  tipo: number;
  tipo_nombre: string;
  status: number;
  status_nombre: string;
  cliente_codigo: string;
  cliente: string;
  rif: string;
  neto: number;
  bruto: number;
  impuesto: number;
  exento: number;
  moneda: number;
  moneda_simbolo: string;
  caja: string;
  serie: string;
  usuario: string;
  deposito: string;
  clasificacion: string;
  items: number;
  /** Líneas de detalle (solo presente cuando se obtiene venta individual) */
  lineas?: HybridVentaLineaInput[];
}

/**
 * Detalle completo de venta: cabecera + líneas.
 */
export interface HybridVentaDetailInput {
  documento: string;
  fecha: string;
  tipo: number;
  tipo_nombre: string;
  status: number;
  status_nombre: string;
  cliente_codigo: string;
  cliente: string;
  rif: string;
  neto: number;
  bruto: number;
  impuesto: number;
  exento: number;
  moneda: number;
  moneda_simbolo: string;
  caja: string;
  serie: string;
  usuario: string;
  deposito: string;
  clasificacion: string;
  lineas: HybridVentaLineaInput[];
}

export interface HybridVentaLineaInput {
  linea: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  unidad: string;
  precio: number;
  importe: number;
  costo: number;
}

/**
 * Producto del catálogo GET /hybrid/inventario.
 */
export interface HybridProductoInput {
  codigo: string;
  nombre: string;
  referencia: string;
  unidad: string;
  familia: string;
  marca: string;
  activo: boolean | number;
  moneda: number;
}

/**
 * Cliente GET /hybrid/clientes.
 */
export interface HybridClienteInput {
  codigo: string;
  nombre: string;
  rif: string;
  nit: string;
  telefono: string;
  email: string;
  direccion: string;
  activo: boolean | number;
}

/**
 * Stock GET /hybrid/existencia.
 */
export interface HybridExistenciaInput {
  codigo: string;
  nombre: string;
  deposito: string;
  lote: string;
  existencia: number;
  apartada: number;
}
