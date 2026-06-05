import { Injectable, Logger } from "@nestjs/common";
import {
  AssistantToolContext,
  AssistantToolsService,
} from "./assistant-tools.service";

type LocalIntent =
  | { type: "current_org" }
  | { type: "invoice_count"; scope: "active" | "all_orgs" }
  | { type: "switch_org"; ref: string }
  | { type: "list_orgs" }
  | { type: "org_status" }
  | { type: "inventory"; product?: string }
  | { type: "fiscal_calendar" };

@Injectable()
export class AssistantLocalFallbackService {
  private readonly logger = new Logger(AssistantLocalFallbackService.name);

  constructor(private readonly tools: AssistantToolsService) {}

  canHandle(message: string): boolean {
    return this.collectIntents(message).length > 0;
  }

  async handle(
    message: string,
    ctx: AssistantToolContext,
  ): Promise<{ reply: string } | null> {
    const intents = this.collectIntents(message);
    if (intents.length === 0) return null;

    this.logger.log(`Local fallback: ${intents.map((i) => i.type).join(", ")}`);

    const answers: string[] = [];
    let n = 1;

    for (const intent of intents) {
      try {
        const line = await this.runIntent(intent, ctx);
        if (line) answers.push(`${n}. ${line}`);
        n++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        answers.push(`${n}. No pude completar esta parte: ${msg}`);
        n++;
      }
    }

    if (answers.length === 0) return null;

    const suffix =
      "\n\n_(Respuesta generada localmente por MARFYL; la IA de Gemini no estuvo disponible.)_";
    return { reply: answers.join("\n\n") + suffix };
  }

  private collectIntents(message: string): LocalIntent[] {
    const segments = this.splitSegments(message);
    const seen = new Set<string>();
    const intents: LocalIntent[] = [];

    for (const segment of segments) {
      for (const intent of this.detectIntents(segment)) {
        const key =
          intent.type === "switch_org"
            ? `switch:${intent.ref.toLowerCase()}`
            : intent.type === "inventory"
              ? `inventory:${intent.product ?? ""}`
              : intent.type;
        if (seen.has(key)) continue;
        seen.add(key);
        intents.push(intent);
      }
    }

    return this.orderIntents(intents);
  }

  private orderIntents(intents: LocalIntent[]): LocalIntent[] {
    const priority: Record<LocalIntent["type"], number> = {
      current_org: 1,
      list_orgs: 2,
      invoice_count: 3,
      org_status: 4,
      inventory: 5,
      fiscal_calendar: 6,
      switch_org: 9,
    };
    return [...intents].sort((a, b) => priority[a.type] - priority[b.type]);
  }

  private splitSegments(message: string): string[] {
    const parts = message
      .split(/(?:\?\s*|\?\s*|\s+y\s+|\s*,\s+|\s*;\s+|\n+)/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    return parts.length > 0 ? parts : [message.trim()];
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  private detectIntents(segment: string): LocalIntent[] {
    const lower = this.normalize(segment);
    const intents: LocalIntent[] = [];

    if (
      /en que empresa|empresa activa|donde estoy|estoy operando|contexto actual|empresa estoy/.test(
        lower,
      )
    ) {
      intents.push({ type: "current_org" });
    }

    if (
      /cuantas facturas|numero de facturas|total de facturas|facturas tengo|facturas hay|cuenta facturas/.test(
        lower,
      )
    ) {
      const allOrgs =
        /mis empresas|todas las empresas|cada empresa|por empresa/.test(lower);
      intents.push({
        type: "invoice_count",
        scope: allOrgs ? "all_orgs" : "active",
      });
    }

    if (/cambia|pasame a|ponme en|switch|mueveme a|ir a/.test(lower)) {
      const ref = this.extractOrgRef(segment);
      if (ref) intents.push({ type: "switch_org", ref });
    }

    if (
      /lista.*empresa|mis empresas|organizaciones|empresas disponibles|empresas tengo/.test(
        lower,
      )
    ) {
      intents.push({ type: "list_orgs" });
    }

    if (
      /estado de la empresa|resumen|dashboard|como va la empresa|metricas/.test(
        lower,
      )
    ) {
      intents.push({ type: "org_status" });
    }

    if (/inventario|stock|productos|existencia/.test(lower)) {
      intents.push({
        type: "inventory",
        product: this.extractProductName(segment),
      });
    }

    if (
      /alertas fiscales|calendario fiscal|vencimientos seniat|obligaciones fiscales/.test(
        lower,
      )
    ) {
      intents.push({ type: "fiscal_calendar" });
    }

    return intents;
  }

  private extractOrgRef(segment: string): string | null {
    const text = this.normalize(segment);
    const patterns = [
      /(?:cambia\w*|pas\w*|pon\w*|muev\w*|switch\w*)\s+(?:a\s+|me\s+a\s+|a\s+la\s+)?(.+)/i,
      /(?:^|\s)(?:a|en|para)\s+([a-z0-9][a-z0-9\s-]{1,40})$/i,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      const ref = m?.[1]?.trim().replace(/[?.!]+$/, "");
      if (ref && ref.length >= 2) return ref;
    }
    return null;
  }

  private extractProductName(segment: string): string | undefined {
    const text = this.normalize(segment);
    const m = text.match(/(?:producto|stock de|inventario de)\s+(.+)/i);
    return m?.[1]?.trim().replace(/[?.!]+$/, "");
  }

  private async runIntent(
    intent: LocalIntent,
    ctx: AssistantToolContext,
  ): Promise<string | null> {
    switch (intent.type) {
      case "current_org":
        return `Estás operando en **${ctx.orgName ?? "tu empresa activa"}** (ID ${ctx.organizationId}).`;

      case "invoice_count": {
        if (intent.scope === "all_orgs") {
          const res = await this.tools.execute(
            "query_invoices_across_my_orgs",
            {},
            ctx,
          );
          if (res.error) throw new Error(res.error);
          const data = res.result as {
            allOrganizations?: Array<{
              name: string;
              totalInvoices: number;
              isActive: boolean;
            }>;
          };
          const rows = data.allOrganizations ?? [];
          if (rows.length === 0)
            return "No encontré empresas asociadas a tu usuario.";
          const lines = rows.map(
            (o) =>
              `• ${o.name}${o.isActive ? " (activa)" : ""}: **${o.totalInvoices}** factura(s)`,
          );
          return `Facturas por empresa:\n${lines.join("\n")}`;
        }
        const active = await this.tools.execute(
          "search_invoices",
          { limit: 1 },
          ctx,
        );
        if (active.error) throw new Error(active.error);
        const count =
          (active.result as { count?: number; organizationName?: string })
            ?.count ?? 0;
        const orgName =
          (active.result as { organizationName?: string })?.organizationName ??
          ctx.orgName;
        return `En **${orgName}** tienes **${count}** factura(s) registrada(s).`;
      }

      case "switch_org": {
        const res = await this.tools.execute(
          "switch_organization",
          { organizationRef: intent.ref },
          ctx,
        );
        if (res.error) throw new Error(res.error);
        const data = res.result as {
          organizationName?: string;
          message?: string;
        };
        return (
          data.message ??
          `Empresa activa cambiada a **${data.organizationName ?? intent.ref}**.`
        );
      }

      case "list_orgs": {
        const res = await this.tools.execute("list_my_organizations", {}, ctx);
        if (res.error) throw new Error(res.error);
        const data = res.result as {
          activeOrganizationName?: string;
          organizations?: Array<{ nombre: string; slug: string; role: string }>;
        };
        const orgs = data.organizations ?? [];
        const lines = orgs.map(
          (o) =>
            `• **${o.nombre}** (${o.slug}) — rol: ${o.role}${o.nombre === data.activeOrganizationName ? " ✓ activa" : ""}`,
        );
        return `Tus empresas (${orgs.length}):\n${lines.join("\n")}`;
      }

      case "org_status": {
        const res = await this.tools.execute(
          "get_organization_status",
          {},
          ctx,
        );
        if (res.error) throw new Error(res.error);
        const data = res.result as {
          organization?: string;
          summary?: {
            totalInvoices?: number;
            totalRevenue?: number;
            pendingInvoices?: number;
          };
          lowStockCount?: number;
        };
        const s = data.summary;
        return (
          `Estado de **${data.organization ?? ctx.orgName}**:\n` +
          `• Facturas: ${s?.totalInvoices ?? "—"}\n` +
          `• Pendientes: ${s?.pendingInvoices ?? "—"}\n` +
          `• Productos bajo stock: ${data.lowStockCount ?? 0}`
        );
      }

      case "inventory": {
        const res = await this.tools.execute(
          "check_inventory_stock",
          intent.product
            ? { productName: intent.product }
            : { lowStockOnly: true },
          ctx,
        );
        if (res.error) throw new Error(res.error);
        const data = res.result as {
          products?: Array<{ name: string; stock: number; minStock?: number }>;
          lowStockProducts?: Array<{ name: string; stock: number }>;
        };
        const items = data.products ?? data.lowStockProducts ?? [];
        if (items.length === 0)
          return "No encontré productos con esos criterios.";
        const lines = items
          .slice(0, 8)
          .map((p) => `• ${p.name}: stock **${p.stock}**`);
        return `Inventario:\n${lines.join("\n")}`;
      }

      case "fiscal_calendar": {
        const res = await this.tools.execute("get_fiscal_calendar", {}, ctx);
        if (res.error) throw new Error(res.error);
        const data = res.result as
          | { events?: Array<{ title?: string; dueDate?: string }> }
          | unknown[];
        const events = Array.isArray(data)
          ? data
          : ((data as { events?: unknown[] })?.events ?? []);
        if (events.length === 0)
          return "No hay alertas fiscales próximas para este período.";
        const lines = (
          events as Array<{
            title?: string;
            dueDate?: string;
            description?: string;
          }>
        )
          .slice(0, 5)
          .map(
            (e) =>
              `• ${e.title ?? e.description ?? "Obligación"}${e.dueDate ? ` — ${e.dueDate}` : ""}`,
          );
        return `Alertas fiscales:\n${lines.join("\n")}`;
      }

      default:
        return null;
    }
  }
}
