/**
 * Marfyl Gemini Chat Handler
 *
 * Handles chat interactions with Gemini including function execution loop.
 * Manages tool handlers, conversation history, and streaming responses.
 */

import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  GoogleGenerativeAI,
  type Content,
  type GenerateContentResult,
} from "@google/generative-ai";
import { PrismaService } from "@/common/prisma/prisma.service";

import {
  MARFYL_TOOLS,
  TOOL_NAMES,
  ToolContext,
  ToolHandlers,
  registerToolHandlers,
} from "./geminiTools";
import {
  SYSTEM_PROMPT,
  DEFAULT_MODEL_CONFIG,
  ModelConfig,
  getOrganizationContext,
  StreamingConfig,
  DEFAULT_STREAMING_CONFIG,
} from "./systemInstructions";

import { InvoicesService } from "@/modules/invoices/invoices.service";
import { ConcertService } from "@/modules/concert/concert.service";
import { FiscalCalendarService } from "@/modules/fiscal/fiscal-calendar.service";
import { ProductsService } from "@/modules/products/products.service";
import { DashboardService } from "@/modules/dashboard/dashboard.service";
import { CustomersService } from "@/modules/customers/customers.service";
import { ExpensesService } from "@/modules/expenses/expenses.service";
import { SuppliersService } from "@/modules/suppliers/suppliers.service";
import { CreditsService } from "@/modules/credits/credits.service";

// ============================================
// Types
// ============================================

export interface ChatMessage {
  role: "user" | "model" | "assistant";
  content: string;
}

export interface ChatRequest {
  message: string;
  history?: ChatMessage[];
  context?: string;
  orgName?: string;
  userRole?: string;
}

export interface ChatResponse {
  reply: string;
  model: string;
  toolsUsed?: string[];
}

export interface StreamingCallback {
  (chunk: string): void | Promise<void>;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

// ============================================
// Sleep utility
// ============================================

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ============================================
// Chat Handler Service
// ============================================

@Injectable()
export class ChatHandler {
  private readonly logger = new Logger(ChatHandler.name);
  private readonly modelCandidates: string[];
  private readonly modelConfig: ModelConfig;
  private readonly streamingConfig: StreamingConfig;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly concertService: ConcertService,
    private readonly fiscalCalendarService: FiscalCalendarService,
    private readonly productsService: ProductsService,
    private readonly dashboardService: DashboardService,
    private readonly customersService: CustomersService,
    private readonly expensesService: ExpensesService,
    private readonly suppliersService: SuppliersService,
    private readonly creditsService: CreditsService,
  ) {
    // Initialize model candidates from config with fallback list
    const configured =
      this.config.get<string>("GEMINI_MODEL")?.trim() ||
      DEFAULT_MODEL_CONFIG.primaryModel;
    this.modelCandidates = [
      configured,
      ...DEFAULT_MODEL_CONFIG.fallbackModels,
    ].filter((m, i, arr) => arr.indexOf(m) === i);

    // Initialize model config
    this.modelConfig = {
      ...DEFAULT_MODEL_CONFIG,
      primaryModel: configured,
    };

    // Initialize streaming config
    this.streamingConfig = {
      ...DEFAULT_STREAMING_CONFIG,
      enabled:
        this.config.get<boolean>("GEMINI_STREAMING_ENABLED") ??
        DEFAULT_STREAMING_CONFIG.enabled,
    };

    // Register tool handlers with actual service implementations
    this.registerToolHandlers();

    this.logger.log(
      `ChatHandler initialized with models: ${this.modelCandidates.join(", ")}`,
    );
  }

  /**
   * Main chat method - processes message and returns response
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");

    if (!apiKey?.trim()) {
      throw new ServiceUnavailableException(
        "Asistente no configurado: defina GEMINI_API_KEY en el backend (.env).",
      );
    }

    const { message, history = [], context, orgName, userRole } = request;

    // Build system instruction with organization context
    let systemInstruction = SYSTEM_PROMPT;
    if (orgName) {
      systemInstruction += "\n\n" + getOrganizationContext(orgName, userRole);
    }
    if (context) {
      systemInstruction += `\n\nContexto adicional: ${context}`;
    }

    // Convert history to Gemini format (last 8 messages for context window)
    const geminiHistory: Content[] = history.slice(-8).map((m) => ({
      role: m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // Add context to message if provided
    const userMessage = context
      ? `[Contexto: ${context}]\n${message}`
      : message;

    let lastError: string | null = null;
    let hadRateLimit = false;
    let toolsUsed: string[] = [];

    // Try each model candidate
    for (let i = 0; i < this.modelCandidates.length; i++) {
      const modelName = this.modelCandidates[i]!;

      try {
        // Rate limit backoff
        if (hadRateLimit && i > 0) {
          await sleep(1200);
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
          tools: MARFYL_TOOLS,
          generationConfig: {
            temperature: this.modelConfig.temperature,
            maxOutputTokens: this.modelConfig.maxOutputTokens,
          },
        });

        // Start chat with history
        const chat = model.startChat({ history: geminiHistory });

        // Send message and get response
        const result = await chat.sendMessage(userMessage);

        // Process response for function calls
        const response = await this.processResponse(result);

        if (response.functionCalls && response.functionCalls.length > 0) {
          // Execute function calls and continue conversation
          const functionResponse = await this.executeFunctionCalls(
            response.functionCalls,
            { organizationId: 0, orgName },
          );
          toolsUsed = response.functionCalls.map((fc) => fc.name);

          // Send function response back to model for final response
          const followUp = model.startChat({
            history: [
              ...geminiHistory,
              { role: "user", parts: [{ text: userMessage }] },
              {
                role: "model",
                parts: [
                  {
                    functionCall: {
                      name: response.functionCalls[0]!.name,
                      args: response.functionCalls[0]!.args,
                    },
                  },
                ],
              },
              {
                role: "function",
                parts: [
                  {
                    functionResponse: {
                      name: response.functionCalls[0]!.name,
                      response: functionResponse,
                    },
                  },
                ],
              },
            ] as Content[],
          });

          const finalResult = await followUp.sendMessage(
            "Responde al usuario con los datos obtenidos.",
          );
          const finalText = finalResult.response.text();

          if (!finalText?.trim()) {
            throw new Error(
              "El modelo no devolvió texto después de las llamadas a funciones.",
            );
          }

          return { reply: finalText.trim(), model: modelName, toolsUsed };
        }

        // No function calls - return direct response
        const text = response.text || result.response.text();

        if (!text?.trim()) {
          throw new Error("El modelo no devolvió texto.");
        }

        return { reply: text.trim(), model: modelName, toolsUsed };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        lastError = msg;

        if (/429|quota|rate limit/i.test(msg)) {
          hadRateLimit = true;
        }

        if (this.isRetryableError(msg)) {
          continue;
        }

        throw new Error(this.toUserMessage(msg));
      }
    }

    throw new Error(
      this.toUserMessage(lastError ?? "Sin respuesta de Gemini."),
    );
  }

  /**
   * Streaming chat - sends response in chunks via callback
   */
  async chatStream(
    request: ChatRequest,
    callback: StreamingCallback,
  ): Promise<ChatResponse> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");

    if (!apiKey?.trim()) {
      throw new ServiceUnavailableException(
        "Asistente no configurado: defina GEMINI_API_KEY en el backend (.env).",
      );
    }

    const { message, history = [], context, orgName, userRole } = request;

    let systemInstruction = SYSTEM_PROMPT;
    if (orgName) {
      systemInstruction += "\n\n" + getOrganizationContext(orgName, userRole);
    }

    const geminiHistory: Content[] = history.slice(-8).map((m) => ({
      role: m.role === "assistant" || m.role === "model" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const userMessage = context
      ? `[Contexto: ${context}]\n${message}`
      : message;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: this.modelCandidates[0]!,
      systemInstruction,
      tools: MARFYL_TOOLS,
    });

    const chat = model.startChat({ history: geminiHistory });
    const result = await chat.sendMessage(userMessage);

    // Stream the response
    const text = result.response.text();
    if (!text?.trim()) {
      return { reply: "", model: this.modelCandidates[0]! };
    }

    if (this.streamingConfig.enabled) {
      // Stream in chunks
      const chunks = this.chunkText(text, this.streamingConfig.chunkSize);
      for (const chunk of chunks) {
        await callback(chunk);
        if (this.streamingConfig.chunkDelay > 0) {
          await sleep(this.streamingConfig.chunkDelay);
        }
      }
    } else {
      // Send full text at once
      await callback(text);
    }

    return { reply: text.trim(), model: this.modelCandidates[0]! };
  }

  // ============================================
  // Response Processing
  // ============================================

  private async processResponse(
    result: GenerateContentResult,
  ): Promise<{ text?: string; functionCalls?: ToolCall[] }> {
    const text = result.response.text();

    const functionCalls = result.response.functionCalls?.();
    if (functionCalls && functionCalls.length > 0) {
      return {
        text: "Estoy consultando la información que necesitas...",
        functionCalls: functionCalls.map((fc) => ({
          name: fc.name,
          args: (fc.args ?? {}) as Record<string, unknown>,
        })),
      };
    }

    return { text };
  }

  // ============================================
  // Function Execution
  // ============================================

  private async executeFunctionCalls(
    calls: ToolCall[],
    context: ToolContext,
  ): Promise<Record<string, unknown>> {
    const results: Record<string, unknown> = {};

    for (const call of calls) {
      try {
        const handler = this.getToolHandler(call.name);
        if (handler) {
          const result = await handler(call.args, context);
          results[call.name] = result;
        } else {
          results[call.name] = {
            success: false,
            error: `Handler no implementado para: ${call.name}`,
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        results[call.name] = {
          success: false,
          error: msg,
        };
        this.logger.error(`Error executing tool ${call.name}: ${msg}`);
      }
    }

    return results;
  }

  private getToolHandler(name: string): ToolHandlers[string] | undefined {
    const handler = this.toolHandlers[name];
    return handler;
  }

  // ============================================
  // Tool Handlers Registry
  // ============================================

  private toolHandlers: ToolHandlers = {};

  private registerToolHandlers(): void {
    this.toolHandlers = {
      // Dashboard tools
      [TOOL_NAMES.GET_DASHBOARD_SUMMARY]: async (_, context) => {
        try {
          const summary = await this.dashboardService.getSummary(
            context.organizationId,
          );
          return { success: true, data: summary };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      [TOOL_NAMES.GET_HEALTH_METRICS]: async (_, context) => {
        try {
          const health = await this.dashboardService.getHealth(
            context.organizationId,
          );
          return { success: true, data: health };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      [TOOL_NAMES.GET_DIAGNOSIS]: async (_, context) => {
        try {
          const diagnosis = await this.dashboardService.getDiagnosis(
            context.organizationId,
          );
          return { success: true, data: diagnosis };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Product tools
      [TOOL_NAMES.GET_PRODUCTS]: async (input, context) => {
        try {
          const { search, lowStockOnly, limit } = input as {
            search?: string;
            lowStockOnly?: boolean;
            limit?: number;
          };
          const result = await this.productsService.findAllPaginated(
            context.organizationId,
            {
              search,
              limit: limit ?? 20,
            },
          );
          // Filter for low stock if requested
          if (lowStockOnly) {
            const lowStockProducts = result.data.filter(
              (p: any) => p.stock < p.minStock,
            );
            return {
              success: true,
              data: { ...result, data: lowStockProducts },
            };
          }
          return { success: true, data: result };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      [TOOL_NAMES.GET_PRODUCT_BY_ID]: async (input, context) => {
        try {
          const { productId } = input as { productId: number };
          const product = await this.productsService.findOne(
            productId,
            context.organizationId,
          );
          return { success: true, data: product };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Invoice tools
      [TOOL_NAMES.GET_INVOICES]: async (input, context) => {
        try {
          const { status, customerId, limit } = input as {
            status?: string;
            customerId?: number;
            limit?: number;
          };
          const result = await this.invoicesService.findAllPaginated(
            context.organizationId,
            {
              status,
              limit: limit ?? 10,
            },
          );
          const data =
            customerId != null
              ? {
                  ...result,
                  data: result.data.filter(
                    (inv: { customerId?: number }) =>
                      inv.customerId === customerId,
                  ),
                }
              : result;
          return { success: true, data };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Customer tools
      [TOOL_NAMES.GET_CUSTOMERS]: async (input, context) => {
        try {
          const { search, limit } = input as {
            search?: string;
            limit?: number;
          };
          // CustomersService.findAll doesn't support search, so we get all and filter
          const customers = await this.customersService.findAll(
            context.organizationId,
          );
          let filtered = customers;
          if (search) {
            const searchLower = search.toLowerCase();
            filtered = customers.filter(
              (c: any) =>
                c.name?.toLowerCase().includes(searchLower) ||
                c.taxId?.toLowerCase().includes(searchLower),
            );
          }
          return { success: true, data: filtered.slice(0, limit ?? 20) };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Expense tools
      [TOOL_NAMES.GET_EXPENSES]: async (input, context) => {
        try {
          const { desde, hasta, categoryId, limit } = input as {
            desde?: string;
            hasta?: string;
            categoryId?: number;
            limit?: number;
          };
          // Get all expenses and filter by date range if provided
          const expenses = await this.expensesService.findAll(
            context.organizationId,
          );
          let filtered = expenses;
          if (desde) {
            const startDate = new Date(desde);
            filtered = filtered.filter(
              (e: any) => new Date(e.date) >= startDate,
            );
          }
          if (hasta) {
            const endDate = new Date(hasta);
            filtered = filtered.filter((e: any) => new Date(e.date) <= endDate);
          }
          if (categoryId) {
            filtered = filtered.filter((e: any) => e.categoryId === categoryId);
          }
          return { success: true, data: filtered.slice(0, limit ?? 20) };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Fiscal tools
      [TOOL_NAMES.GET_FISCAL_CALENDAR]: async (input, context) => {
        try {
          const { month, year } = input as { month?: number; year?: number };
          const now = new Date();
          const targetYear = year ?? now.getFullYear();
          const targetMonth = month ?? now.getMonth() + 1;
          const calendar = await this.fiscalCalendarService.listCalendar(
            context.organizationId,
            targetYear,
            targetMonth,
          );
          return { success: true, data: calendar };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      [TOOL_NAMES.GET_FISCAL_BOOKS]: async () => {
        // Fiscal books require complex period and type handling
        // Return a message guiding the user to the fiscal module
        return {
          success: true,
          data: {
            message:
              "Para consultar libros fiscales (ventas, compras, retención IVA), usa el módulo Fiscal en Marfyl. Los libros se generan mensualmente y deben enviarse al SENIAT.",
          },
        };
      },

      // Credit tools
      [TOOL_NAMES.GET_CUSTOMER_CREDITS]: async (input, context) => {
        try {
          const { customerId } = input as { customerId: number };
          // Get or create credit for customer, then get transactions
          const credit = await this.creditsService.getOrCreateCredit(
            customerId,
            context.organizationId,
          );
          const transactions = await this.creditsService.getTransactions(
            credit.id,
            context.organizationId,
          );
          return { success: true, data: { credit, transactions } };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Supplier tools
      [TOOL_NAMES.GET_SUPPLIERS]: async (input, context) => {
        try {
          const { search, limit } = input as {
            search?: string;
            limit?: number;
          };
          const suppliers = await this.suppliersService.findAll(
            context.organizationId,
          );
          let filtered = suppliers;
          if (search) {
            const searchLower = search.toLowerCase();
            filtered = suppliers.filter(
              (s: any) =>
                s.name?.toLowerCase().includes(searchLower) ||
                s.taxId?.toLowerCase().includes(searchLower),
            );
          }
          return { success: true, data: filtered.slice(0, limit ?? 20) };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          return { success: false, error: msg };
        }
      },

      // Help tool
      [TOOL_NAMES.SEARCH_HELP]: async (input) => {
        const { query } = input as { query: string };
        return {
          success: true,
          data: {
            message: `Búsqueda de ayuda: "${query}" - Consulta la documentación en https://docs.marfyl.com o contacta a soporte@marfyl.com`,
          },
        };
      },
    };

    // Register handlers for external access
    registerToolHandlers(this.toolHandlers);
  }

  // ============================================
  // Utility Methods
  // ============================================

  private isRetryableError(message: string): boolean {
    return (
      /404/i.test(message) ||
      /not found/i.test(message) ||
      /not supported/i.test(message) ||
      /is not found for API version/i.test(message) ||
      /429/i.test(message) ||
      /quota/i.test(message) ||
      /rate limit/i.test(message) ||
      /503/i.test(message) ||
      /overloaded/i.test(message)
    );
  }

  private toUserMessage(raw: string): string {
    if (/404/i.test(raw) && /gemini/i.test(raw)) {
      return "Modelo de IA no disponible. Use GEMINI_MODEL=gemini-2.0-flash-lite en backend/.env y reinicie.";
    }

    if (/429|quota|rate limit/i.test(raw)) {
      return "Cuota de Gemini agotada. El servidor ya probó modelos lite; espere 1–2 minutos o reinicie el backend.";
    }

    return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
  }

  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
  }
}
