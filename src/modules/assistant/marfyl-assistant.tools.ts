import { FunctionDeclaration, SchemaType, Tool } from "@google/generative-ai";

export const MARFYL_SYSTEM_INSTRUCTION = `Eres el "Asistente Fiscal Inteligente", agente operativo nativo de MARFYL (facturación, POS, inventario y control tributario venezolano). Ejecutas acciones reales con las herramientas proporcionadas.

Reglas de comportamiento:
1. MULTITENANT SEGURO: Solo operas en empresas a las que ESTE usuario tiene acceso. Nunca reveles ni consultes datos de organizaciones ajenas. Si piden cambiar de empresa ("cámbiame a Monddy"), usa switch_organization. Si preguntan "¿en qué empresa tengo facturas?", usa query_invoices_across_my_orgs o list_my_organizations.
2. EJECUCIÓN ACTIVA: Ante "busca facturas", "anúlala", "edita stock", "cambia precio", "registra merma" o "busca boleto", ejecuta la herramienta correcta de inmediato. No digas que no puedes si existe la herramienta.
3. OPERACIONES PERMITIDAS: consultas, búsquedas, cambio de empresa activa, edición de productos/stock, movimientos de inventario (merma/autoconsumo), ajuste y anulación de facturas, clientes, caja, libros fiscales, retenciones, cuentas por pagar y boletos QR.
4. LÍMITES: No reestructuras BD, no accedes a otros usuarios ni empresas fuera de la membresía del cliente. Para contabilidad profunda multi-año sin datos, deriva al módulo Fiscal del menú.
5. CONFIRMACIÓN: Para anular facturas o ajustar montos sin ID/motivo claros, pide confirmación antes de ejecutar.
6. TONO: Directo, profesional, español venezolano (RIF, IVA, SENIAT, Nota de Crédito).
7. DATOS: Nunca inventes montos ni RIF. Solo usa resultados de herramientas.
8. MÚLTIPLES PREGUNTAS: Si el usuario envía 2 o más preguntas o pedidos en un solo mensaje (ej: "¿en qué empresa estoy? y cámbiame a Monddy"), debes atender TODAS las partes en orden, numeradas (1., 2., 3.). Ejecuta las herramientas necesarias para cada parte antes de responder. No ignores ninguna solicitud del mensaje.
9. HISTORIAL: Usa el historial de la conversación para mantener coherencia. Si ya informaste algo en turnos anteriores, puedes referenciarlo sin repetir herramientas innecesarias.`;

const objectSchema = (
  properties: FunctionDeclaration["parameters"]["properties"],
  required?: string[],
) => ({
  type: SchemaType.OBJECT,
  properties,
  ...(required?.length ? { required } : {}),
});

export const MARFYL_ASSISTANT_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "list_my_organizations",
    description:
      "Lista las empresas/organizaciones a las que el usuario actual tiene acceso (solo las suyas).",
    parameters: objectSchema({}),
  },
  {
    name: "switch_organization",
    description:
      "Cambia la empresa activa del usuario. Usar slug o nombre parcial (ej: monddy, El Rancho). Solo empresas donde el usuario es miembro.",
    parameters: objectSchema(
      {
        organizationRef: {
          type: SchemaType.STRING,
          description: "Slug o nombre de la empresa destino",
        },
      },
      ["organizationRef"],
    ),
  },
  {
    name: "query_invoices_across_my_orgs",
    description:
      "Indica en cuáles de las empresas del usuario hay facturas registradas y cuántas.",
    parameters: objectSchema({}),
  },
  {
    name: "search_invoices",
    description:
      "Busca y lista facturas por cliente, estado, número o término libre en la empresa activa.",
    parameters: objectSchema({
      searchTerm: {
        type: SchemaType.STRING,
        description: "Cliente, número de factura o nota (opcional)",
      },
      status: {
        type: SchemaType.STRING,
        description: "PAID, PENDING o CANCELLED (opcional)",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Cantidad máxima de registros (default 10)",
      },
    }),
  },
  {
    name: "get_invoice_detail",
    description:
      "Obtiene el detalle completo de una factura por ID o número consecutivo.",
    parameters: objectSchema(
      {
        invoiceId: {
          type: SchemaType.STRING,
          description: "ID numérico o referencia ej. F-0012",
        },
      },
      ["invoiceId"],
    ),
  },
  {
    name: "modify_invoice_amount",
    description:
      "Ajusta el monto de una factura emitiendo nota de crédito (monto menor al actual).",
    parameters: objectSchema(
      {
        invoiceId: {
          type: SchemaType.STRING,
          description: "ID o número de factura",
        },
        newAmount: {
          type: SchemaType.NUMBER,
          description: "Nuevo monto total en USD",
        },
        reason: { type: SchemaType.STRING, description: "Motivo del ajuste" },
      },
      ["invoiceId", "newAmount", "reason"],
    ),
  },
  {
    name: "annul_invoice",
    description:
      "Anula una factura en el sistema (acción irreversible). Requiere motivo.",
    parameters: objectSchema(
      {
        invoiceId: {
          type: SchemaType.STRING,
          description: "ID o número de factura",
        },
        reason: {
          type: SchemaType.STRING,
          description: "Motivo de la anulación",
        },
      },
      ["invoiceId", "reason"],
    ),
  },
  {
    name: "check_inventory_stock",
    description:
      "Consulta existencias de un producto o lista productos con stock bajo.",
    parameters: objectSchema({
      productName: {
        type: SchemaType.STRING,
        description: "Nombre, SKU o código de barras (opcional)",
      },
      lowStockOnly: {
        type: SchemaType.BOOLEAN,
        description: "Si true, solo alertas de stock bajo",
      },
    }),
  },
  {
    name: "update_product",
    description:
      "Actualiza un producto: stock, precio de venta, stock mínimo, nombre o SKU.",
    parameters: objectSchema(
      {
        productId: { type: SchemaType.NUMBER, description: "ID del producto" },
        stock: {
          type: SchemaType.NUMBER,
          description: "Nuevo stock (opcional)",
        },
        salePrice: {
          type: SchemaType.NUMBER,
          description: "Nuevo precio de venta (opcional)",
        },
        minStock: {
          type: SchemaType.NUMBER,
          description: "Nuevo stock mínimo (opcional)",
        },
        name: {
          type: SchemaType.STRING,
          description: "Nuevo nombre (opcional)",
        },
      },
      ["productId"],
    ),
  },
  {
    name: "register_inventory_outflow",
    description:
      "Registra salida de inventario: autoconsumo, merma vencido/dañado o uso taller. Resta stock.",
    parameters: objectSchema(
      {
        productId: { type: SchemaType.NUMBER, description: "ID del producto" },
        quantity: {
          type: SchemaType.NUMBER,
          description: "Cantidad a descontar",
        },
        type: {
          type: SchemaType.STRING,
          description: "AUTOCONSUMO, MERMA_VENCIDO, MERMA_DANADO o USO_TALLER",
        },
        reason: { type: SchemaType.STRING, description: "Motivo (opcional)" },
      },
      ["productId", "quantity", "type"],
    ),
  },
  {
    name: "create_customer",
    description: "Crea un cliente en la empresa activa.",
    parameters: objectSchema(
      {
        name: { type: SchemaType.STRING, description: "Nombre o razón social" },
        taxId: {
          type: SchemaType.STRING,
          description: "RIF o cédula (opcional)",
        },
        email: { type: SchemaType.STRING, description: "Email (opcional)" },
        phone: { type: SchemaType.STRING, description: "Teléfono (opcional)" },
      },
      ["name"],
    ),
  },
  {
    name: "search_customers",
    description: "Busca clientes por nombre, RIF o cédula.",
    parameters: objectSchema(
      {
        searchTerm: {
          type: SchemaType.STRING,
          description: "Nombre o documento del cliente",
        },
      },
      ["searchTerm"],
    ),
  },
  {
    name: "get_organization_status",
    description:
      "Resumen operativo: ventas del día, productos, stock bajo y transacciones recientes.",
    parameters: objectSchema({}),
  },
  {
    name: "get_fiscal_calendar",
    description:
      "Fechas límite fiscales SENIAT del período (IVA, retenciones, obligaciones).",
    parameters: objectSchema({
      periodYear: {
        type: SchemaType.NUMBER,
        description: "Año (default: actual)",
      },
      periodMonth: {
        type: SchemaType.NUMBER,
        description: "Mes 1-12 (default: actual)",
      },
    }),
  },
  {
    name: "get_libro_ventas",
    description: "Consulta líneas del libro de ventas del período fiscal.",
    parameters: objectSchema({
      periodYear: { type: SchemaType.NUMBER, description: "Año del período" },
      periodMonth: { type: SchemaType.NUMBER, description: "Mes del período" },
    }),
  },
  {
    name: "get_libro_compras",
    description: "Consulta líneas del libro de compras del período fiscal.",
    parameters: objectSchema({
      periodYear: { type: SchemaType.NUMBER, description: "Año del período" },
      periodMonth: { type: SchemaType.NUMBER, description: "Mes del período" },
    }),
  },
  {
    name: "get_fiscal_retenciones",
    description: "Lista retenciones de IVA/ISLR del período.",
    parameters: objectSchema({
      periodYear: { type: SchemaType.NUMBER, description: "Año del período" },
      periodMonth: { type: SchemaType.NUMBER, description: "Mes del período" },
    }),
  },
  {
    name: "get_accounts_payable",
    description:
      "Gastos y facturas de compra pendientes de pago (cuentas por pagar).",
    parameters: objectSchema({}),
  },
  {
    name: "get_cash_register_status",
    description:
      "Estado del turno de caja abierto del usuario (X-Report: efectivo, digital, autoconsumos).",
    parameters: objectSchema({}),
  },
  {
    name: "search_event_ticket",
    description:
      "Busca órdenes/boletos del evento por nombre, cédula o correo del comprador.",
    parameters: objectSchema(
      {
        searchCriteria: {
          type: SchemaType.STRING,
          description: "Nombre, cédula o email",
        },
      },
      ["searchCriteria"],
    ),
  },
  {
    name: "manual_qr_checkin",
    description:
      "Registra check-in manual de boleto QR (payload del código o token del ticket).",
    parameters: objectSchema(
      {
        ticketId: {
          type: SchemaType.STRING,
          description: "Payload QR o código del boleto",
        },
      },
      ["ticketId"],
    ),
  },
];

export function buildMarfylAssistantTools(): Tool[] {
  return [{ functionDeclarations: MARFYL_ASSISTANT_FUNCTION_DECLARATIONS }];
}
