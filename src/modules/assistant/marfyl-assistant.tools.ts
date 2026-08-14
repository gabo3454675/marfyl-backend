import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const MARFYL_SYSTEM_INSTRUCTION = `Eres MARFYL, el asistente operativo del local en Venezuela. Ayudas a vender, cuadrar caja, inventario, piso y compras. También puedes orientar en SENIAT si te lo piden.

Reglas:
1. SALUDOS: 1 frase amable y ofrece ayuda concreta (cómo va el día, stock, caja, foto de factura). NO uses herramientas en un hola.
2. MODELO: Si preguntan qué IA eres, responde solo "Nemotron". Sin herramientas.
3. MULTITENANT: Solo esta empresa. Para cambiar de local usa switch_organization.
4. EJECUCIÓN: Ante "cómo vamos", "qué se vendió", "qué falta", "caja", "qué compro", llama YA get_organization_status y/o get_cash_register_status / suggest_restock. No digas que no puedes si hay herramienta.
5. CORTO: 2-3 párrafos o viñetas "• ". **Negritas** en cifras. Nada de paredes de texto.
6. FOTO DE FACTURA: Tú no lees imágenes en el chat. Indica Inventario → Compras → Foto/PDF (o Gastos → escanear). No inventes líneas de una foto que no viste.
7. FISCAL: search_fiscal_law SOLO si preguntan plazos, IVA, ISLR, IGTF, COT o sanciones. No lo uses en operación del día.
8. CONFIRMACIÓN: Anular factura o cambiar montos requiere ID y motivo.
9. DATOS: Nunca inventes ventas, stock ni RIF. Solo resultados de herramientas.
10. TONO: Español venezolano, directo, de encargado de local.`;

type JsonSchemaProperty = {
  type: "string" | "number" | "boolean";
  description?: string;
};

type JsonObjectSchema = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
};

const objectSchema = (
  properties: Record<string, JsonSchemaProperty>,
  required?: string[],
): JsonObjectSchema => ({
  type: "object",
  properties,
  ...(required?.length ? { required } : {}),
});

export interface MarfylAssistantFunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonObjectSchema;
}

export const MARFYL_ASSISTANT_FUNCTION_DECLARATIONS: MarfylAssistantFunctionDeclaration[] =
  [
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
            type: "string",
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
          type: "string",
          description: "Cliente, número de factura o nota (opcional)",
        },
        status: {
          type: "string",
          description: "PAID, PENDING o CANCELLED (opcional)",
        },
        limit: {
          type: "number",
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
            type: "string",
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
            type: "string",
            description: "ID o número de factura",
          },
          newAmount: {
            type: "number",
            description: "Nuevo monto total en USD",
          },
          reason: { type: "string", description: "Motivo del ajuste" },
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
            type: "string",
            description: "ID o número de factura",
          },
          reason: {
            type: "string",
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
          type: "string",
          description: "Nombre, SKU o código de barras (opcional)",
        },
        lowStockOnly: {
          type: "boolean",
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
          productId: { type: "number", description: "ID del producto" },
          stock: {
            type: "number",
            description: "Nuevo stock (opcional)",
          },
          salePrice: {
            type: "number",
            description: "Nuevo precio de venta (opcional)",
          },
          minStock: {
            type: "number",
            description: "Nuevo stock mínimo (opcional)",
          },
          name: {
            type: "string",
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
          productId: { type: "number", description: "ID del producto" },
          quantity: {
            type: "number",
            description: "Cantidad a descontar",
          },
          type: {
            type: "string",
            description: "AUTOCONSUMO, MERMA_VENCIDO, MERMA_DANADO o USO_TALLER",
          },
          reason: { type: "string", description: "Motivo (opcional)" },
        },
        ["productId", "quantity", "type"],
      ),
    },
    {
      name: "create_customer",
      description: "Crea un cliente en la empresa activa.",
      parameters: objectSchema(
        {
          name: { type: "string", description: "Nombre o razón social" },
          taxId: {
            type: "string",
            description: "RIF o cédula (opcional)",
          },
          email: { type: "string", description: "Email (opcional)" },
          phone: { type: "string", description: "Teléfono (opcional)" },
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
            type: "string",
            description: "Nombre o documento del cliente",
          },
        },
        ["searchTerm"],
      ),
    },
    {
      name: "get_organization_status",
      description:
        "Resumen del local AHORA: ventas hoy vs ayer, caja abierta, pedidos de piso sin cobrar, stock bajo, top productos del día y licores que quedan. Usar si preguntan cómo vamos, qué se vendió, qué falta, resumen o el día.",
      parameters: objectSchema({}),
    },
    {
      name: "get_ops_briefing",
      description:
        "Alias de get_organization_status: resumen operativo del turno (ventas, caja, piso, stock, licores).",
      parameters: objectSchema({}),
    },
    {
      name: "suggest_restock",
      description:
        "Qué conviene reponer: productos en o bajo mínimo, stock actual y si se vendieron hoy. Usar si preguntan qué comprar, qué se acaba o qué pedir al proveedor.",
      parameters: objectSchema({
        limit: {
          type: "number",
          description: "Máximo de productos (default 12)",
        },
      }),
    },
    {
      name: "get_fiscal_calendar",
      description:
        "Fechas límite fiscales SENIAT del período (IVA, retenciones, obligaciones).",
      parameters: objectSchema({
        periodYear: {
          type: "number",
          description: "Año (default: actual)",
        },
        periodMonth: {
          type: "number",
          description: "Mes 1-12 (default: actual)",
        },
      }),
    },
    {
      name: "get_libro_ventas",
      description: "Consulta líneas del libro de ventas del período fiscal.",
      parameters: objectSchema({
        periodYear: { type: "number", description: "Año del período" },
        periodMonth: { type: "number", description: "Mes del período" },
      }),
    },
    {
      name: "get_libro_compras",
      description: "Consulta líneas del libro de compras del período fiscal.",
      parameters: objectSchema({
        periodYear: { type: "number", description: "Año del período" },
        periodMonth: { type: "number", description: "Mes del período" },
      }),
    },
    {
      name: "get_fiscal_retenciones",
      description: "Lista retenciones de IVA/ISLR del período.",
      parameters: objectSchema({
        periodYear: { type: "number", description: "Año del período" },
        periodMonth: { type: "number", description: "Mes del período" },
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
        "Turno de caja del usuario: abierto/cerrado, monto inicial USD y Bs, ventas efectivo/punto/pago móvil. Usar si preguntan por la caja, el interruptor o el cuadre.",
      parameters: objectSchema({}),
    },
    {
      name: "search_event_ticket",
      description:
        "Busca órdenes/boletos del evento por nombre, cédula o correo del comprador.",
      parameters: objectSchema(
        {
          searchCriteria: {
            type: "string",
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
            type: "string",
            description: "Payload QR o código del boleto",
          },
        },
        ["ticketId"],
      ),
    },
    {
      name: "search_fiscal_law",
      description:
        "Busca artículos de leyes y normativa fiscal venezolana (COT, IVA, ISLR, IGTF, providencias, calendario). SOLO cuando el usuario pregunte obligaciones, plazos, sanciones o tratamiento tributario concreto. NO usar para saludos, charla, ni preguntas sobre qué modelo/IA eres.",
      parameters: objectSchema({
        query: {
          type: "string",
          description:
            "Consulta en lenguaje natural (ej: retención IVA servicios, plazo declaración ISLR, sanción por no emitir factura, qué dice el artículo 120 del COT)",
        },
        ley: {
          type: "string",
          description:
            "Filtrar por norma: COT, LIVA, RIVA, LISLR, RISLR, LIGTF, PROV_0071, CALENDARIO_2026, PROV_SNAT_0141 (opcional)",
        },
        articulo: {
          type: "number",
          description:
            "Número de artículo si el usuario lo menciona (ej: 120). Mejora el rerank semántico.",
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de fragmentos (default 5, máx 10)",
        },
      }, ["query"]),
    },
    {
      name: "brave_search",
      description:
        "Alias de search_fiscal_law. Solo normativa fiscal concreta (plazos, sanciones, IVA, ISLR, IGTF, COT). No usar en saludos ni preguntas sobre el modelo de IA.",
      parameters: objectSchema({
        query: {
          type: "string",
          description: "Consulta fiscal en lenguaje natural",
        },
        ley: {
          type: "string",
          description: "Norma opcional: COT, LIVA, RIVA, LISLR, etc.",
        },
        articulo: {
          type: "number",
          description: "Número de artículo mencionado por el usuario (opcional)",
        },
        limit: {
          type: "number",
          description: "Cantidad máxima de fragmentos (default 5)",
        },
      }, ["query"]),
    },
  ];

export function buildGroqAssistantTools(): ChatCompletionTool[] {
  return MARFYL_ASSISTANT_FUNCTION_DECLARATIONS.map((fn) => ({
    type: "function",
    function: {
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
    },
  }));
}
