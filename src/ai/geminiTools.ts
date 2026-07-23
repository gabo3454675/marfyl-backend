/**
 * Marfyl Gemini Tools - Function Declarations
 *
 * This module defines the tools/functions that the Gemini model can call
 * to perform operations within the Marfyl SaaS platform.
 *
 * Each tool follows the Google Generative AI function calling format.
 */

import { FunctionDeclaration, Tool, SchemaType } from "@google/generative-ai";

// ============================================
// Type Definitions
// ============================================

/**
 * Result type for tool execution
 */
export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  organizationId: number;
  userId?: number;
  orgName?: string;
}

// ============================================
// Tool Schemas
// ============================================

/**
 * Get dashboard summary data
 */
const getDashboardSummarySchema: FunctionDeclaration = {
  name: "get_dashboard_summary",
  description:
    "Obtiene el resumen del dashboard: ventas del día, productos en stock, productos con stock bajo, y últimas transacciones.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {},
  },
};

/**
 * Get health metrics for the organization
 */
const getHealthMetricsSchema: FunctionDeclaration = {
  name: "get_health_metrics",
  description:
    "Obtiene métricas de salud del negocio: ticket promedio, crecimiento mensual, meta diaria y ganancia neta estimada.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {},
  },
};

/**
 * Get diagnosis data (margin erosion and debt aging)
 */
const getDiagnosisSchema: FunctionDeclaration = {
  name: "get_diagnosis",
  description:
    "Obtiene diagnóstico de salud del negocio: productos con margen bajo (erosión) y antigüedad de deuda por cliente.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {},
  },
};

/**
 * Get list of products with optional filters
 */
const getProductsSchema: FunctionDeclaration = {
  name: "get_products",
  description:
    "Obtiene lista de productos del inventario con filtros opcionales.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      lowStockOnly: {
        type: SchemaType.BOOLEAN,
        description: "Filtrar solo productos con stock bajo",
      },
      search: {
        type: SchemaType.STRING,
        description: "Buscar por nombre o SKU",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Límite de resultados (default 20)",
      },
    },
  },
};

/**
 * Get product details by ID
 */
const getProductByIdSchema: FunctionDeclaration = {
  name: "get_product_by_id",
  description: "Obtiene detalles de un producto específico por su ID.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      productId: {
        type: SchemaType.NUMBER,
        description: "ID del producto",
      },
    },
    required: ["productId"],
  },
};

/**
 * Get recent invoices
 */
const getInvoicesSchema: FunctionDeclaration = {
  name: "get_invoices",
  description: "Obtiene facturas recientes con filtros opcionales.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      status: {
        type: SchemaType.STRING,
        format: "enum",
        enum: ["PENDING", "PAID", "CANCELLED"],
        description: "Filtrar por estado de factura",
      },
      customerId: {
        type: SchemaType.NUMBER,
        description: "Filtrar por cliente",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Límite de resultados (default 10)",
      },
    },
  },
};

/**
 * Get customers list
 */
const getCustomersSchema: FunctionDeclaration = {
  name: "get_customers",
  description: "Obtiene lista de clientes.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      search: {
        type: SchemaType.STRING,
        description: "Buscar por nombre o RIF",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Límite de resultados (default 20)",
      },
    },
  },
};

/**
 * Get expenses summary
 */
const getExpensesSchema: FunctionDeclaration = {
  name: "get_expenses",
  description: "Obtiene gastos registrados con filtros de fecha.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      desde: {
        type: SchemaType.STRING,
        description: "Fecha inicio (YYYY-MM-DD)",
      },
      hasta: {
        type: SchemaType.STRING,
        description: "Fecha fin (YYYY-MM-DD)",
      },
      categoryId: {
        type: SchemaType.NUMBER,
        description: "Filtrar por categoría",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Límite de resultados (default 20)",
      },
    },
  },
};

/**
 * Get fiscal calendar events
 */
const getFiscalCalendarSchema: FunctionDeclaration = {
  name: "get_fiscal_calendar",
  description:
    "Obtiene eventos del calendario fiscal SENIAT: fechas de declaraciones, vencimientos, etc.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      month: {
        type: SchemaType.NUMBER,
        description: "Mes (1-12), default mes actual",
      },
      year: {
        type: SchemaType.NUMBER,
        description: "Año (YYYY), default año actual",
      },
    },
  },
};

/**
 * Get fiscal books summary
 */
const getFiscalBooksSchema: FunctionDeclaration = {
  name: "get_fiscal_books",
  description:
    "Obtiene resumen de libros fiscales: ventas, compras, retención IVA.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      period: {
        type: SchemaType.STRING,
        description: "Período (YYYY-MM), default período actual",
      },
      type: {
        type: SchemaType.STRING,
        format: "enum",
        enum: ["sales", "purchases", "withholding"],
        description: "Tipo de libro",
      },
    },
  },
};

/**
 * Get credits/accounts receivable for a customer
 */
const getCustomerCreditsSchema: FunctionDeclaration = {
  name: "get_customer_credits",
  description: "Obtiene las cuentas por cobrar de un cliente específico.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      customerId: {
        type: SchemaType.NUMBER,
        description: "ID del cliente",
      },
    },
    required: ["customerId"],
  },
};

/**
 * Get supplier list
 */
const getSuppliersSchema: FunctionDeclaration = {
  name: "get_suppliers",
  description: "Obtiene lista de proveedores.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      search: {
        type: SchemaType.STRING,
        description: "Buscar por nombre o RIF",
      },
      limit: {
        type: SchemaType.NUMBER,
        description: "Límite de resultados (default 20)",
      },
    },
  },
};

/**
 * Search help content
 */
const searchHelpSchema: FunctionDeclaration = {
  name: "search_help",
  description:
    "Busca en la base de conocimiento de ayuda para responder preguntas sobre el sistema.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      query: {
        type: SchemaType.STRING,
        description: "Término de búsqueda",
      },
    },
    required: ["query"],
  },
};

// ============================================
// Tool Registry
// ============================================

/**
 * All available tools for the assistant
 */
export const MARFYL_TOOLS: Tool[] = [
  {
    functionDeclarations: [
      getDashboardSummarySchema,
      getHealthMetricsSchema,
      getDiagnosisSchema,
      getProductsSchema,
      getProductByIdSchema,
      getInvoicesSchema,
      getCustomersSchema,
      getExpensesSchema,
      getFiscalCalendarSchema,
      getFiscalBooksSchema,
      getCustomerCreditsSchema,
      getSuppliersSchema,
      searchHelpSchema,
    ],
  },
];

/**
 * Tool names enum for type-safe access
 */
export const TOOL_NAMES = {
  GET_DASHBOARD_SUMMARY: "get_dashboard_summary",
  GET_HEALTH_METRICS: "get_health_metrics",
  GET_DIAGNOSIS: "get_diagnosis",
  GET_PRODUCTS: "get_products",
  GET_PRODUCT_BY_ID: "get_product_by_id",
  GET_INVOICES: "get_invoices",
  GET_CUSTOMERS: "get_customers",
  GET_EXPENSES: "get_expenses",
  GET_FISCAL_CALENDAR: "get_fiscal_calendar",
  GET_FISCAL_BOOKS: "get_fiscal_books",
  GET_CUSTOMER_CREDITS: "get_customer_credits",
  GET_SUPPLIERS: "get_suppliers",
  SEARCH_HELP: "search_help",
} as const;

/**
 * Tool execution handler type
 */
export type ToolHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  input: TInput,
  context: ToolContext,
) => Promise<ToolExecutionResult<TOutput>>;

// ============================================
// Tool Handlers Map
// ============================================

/**
 * Map of tool names to their handler functions
 * Handlers are implemented in chatHandler.ts
 */
export interface ToolHandlers {
  [key: string]: ToolHandler;
}

/**
 * Placeholder for tool handlers - will be injected from chatHandler
 */
let toolHandlers: ToolHandlers = {};

/**
 * Register tool handlers from chatHandler
 */
export function registerToolHandlers(handlers: ToolHandlers): void {
  toolHandlers = { ...toolHandlers, ...handlers };
}

/**
 * Get a tool handler by name
 */
export function getToolHandler(name: string): ToolHandler | undefined {
  return toolHandlers[name];
}

/**
 * Get all registered tool names
 */
export function getRegisteredToolNames(): string[] {
  return Object.keys(toolHandlers);
}

// ============================================
// Utility Functions
// ============================================

/**
 * Format a tool result for display in chat
 */
export function formatToolResult(
  result: ToolExecutionResult,
  toolName: string,
): string {
  if (!result.success) {
    return `❌ Error al ejecutar ${toolName}: ${result.error}`;
  }

  if (result.data === undefined) {
    return `${toolName}: OK`;
  }

  try {
    return JSON.stringify(result.data, null, 2);
  } catch {
    return String(result.data);
  }
}

/**
 * Truncate long tool results for display
 */
export function truncateForDisplay(
  text: string,
  maxLength: number = 500,
): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "... (resultado truncado)";
}
