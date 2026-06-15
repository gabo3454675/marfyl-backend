import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Groq } from "groq-sdk";
import { FiscalKnowledgeService } from "@/modules/fiscal-knowledge/fiscal-knowledge.service";
import {
  runPreventiveAudit,
  type AuditWarning,
  type PerfilEmpresa,
  type ResumenOperativo,
} from "./fiscal-audit.rules";
import type { FiscalAdvisorDto } from "./dto/fiscal-advisor.dto";

export type FiscalAdvisorStreamEvent =
  | { type: "status"; phase: "thinking" | "analyzing" | "searching" | "generating" }
  | { type: "audit_warnings"; warnings: AuditWarning[] }
  | {
      type: "knowledge";
      articles: Array<{
        ley: string;
        leyLabel: string;
        articulo: number;
        excerpt: string;
        similarity: number;
      }>;
    }
  | { type: "delta"; text: string }
  | { type: "done"; model: string }
  | { type: "error"; message: string };

const DEFAULT_FAST_MODEL = "llama-3.1-8b-instant";
const ROUTINE_QUERY =
  "sanciones multas ilícitos tributarios infracciones COT providencias contribuyente especial";

function usesReasoningEffort(model: string): boolean {
  return /gpt-oss|reasoning/i.test(model);
}

@Injectable()
export class FiscalAdvisorService {
  private readonly logger = new Logger(FiscalAdvisorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly knowledge: FiscalKnowledgeService,
  ) {}

  async *adviseStream(
    dto: FiscalAdvisorDto,
  ): AsyncGenerator<FiscalAdvisorStreamEvent> {
    if (!dto.perfilEmpresa || !dto.resumenOperativo) {
      throw new ServiceUnavailableException(
        "No se pudo construir el contexto fiscal de la empresa.",
      );
    }

    const perfil = dto.perfilEmpresa as PerfilEmpresa;
    const resumen: ResumenOperativo = {
      totalFacturadoMes: dto.resumenOperativo.totalFacturadoMes ?? 0,
      pagosDivisasEfectivo: dto.resumenOperativo.pagosDivisasEfectivo ?? 0,
      igtfRecaudado: dto.resumenOperativo.igtfRecaudado ?? 0,
      ultimaDeclaracionIVA: dto.resumenOperativo.ultimaDeclaracionIVA ?? null,
      facturasSinMaquinaFiscal: dto.resumenOperativo.facturasSinMaquinaFiscal ?? 0,
    };

    yield { type: "status", phase: "analyzing" };

    const warnings = runPreventiveAudit(perfil, resumen);
    yield { type: "audit_warnings", warnings };

    const apiKey = this.config.get<string>("GROQ_API_KEY")?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        "Asesor fiscal no configurado: defina GROQ_API_KEY.",
      );
    }

    const mensaje = dto.mensajeUsuario?.trim() ?? "";
    const searchQuery = mensaje || ROUTINE_QUERY;

    yield { type: "status", phase: "searching" };

    let articles: Awaited<ReturnType<FiscalKnowledgeService["search"]>> = [];
    try {
      const ready = await this.knowledge.isReady();
      if (ready) {
        articles = await this.knowledge.search(searchQuery, { limit: 4 });
      }
    } catch (error) {
      this.logger.warn(
        `Búsqueda vectorial falló: ${error instanceof Error ? error.message : error}`,
      );
    }

    yield {
      type: "knowledge",
      articles: articles.map((a) => ({
        ley: a.ley,
        leyLabel: a.leyLabel,
        articulo: a.articulo,
        excerpt: a.content.slice(0, 600),
        similarity: a.similarity,
      })),
    };

    yield { type: "status", phase: "generating" };

    const fastModel =
      this.config.get<string>("GROQ_MODEL")?.trim() || DEFAULT_FAST_MODEL;
    const configuredAdvisor =
      this.config.get<string>("FISCAL_ADVISOR_MODEL")?.trim() || "";
    const primaryModel =
      configuredAdvisor && !usesReasoningEffort(configuredAdvisor)
        ? configuredAdvisor
        : fastModel;
    const fallbackModel = fastModel;

    const systemPrompt = this.buildSystemPrompt(
      perfil,
      resumen,
      warnings,
      articles,
      mensaje,
    );

    const userContent = mensaje
      ? mensaje
      : "Realiza una auditoría preventiva de rutina y explícame el estado de salud fiscal de mi empresa.";

    const groq = new Groq({ apiKey });
    let modelUsed = primaryModel;

    const runStream = async function* (modelName: string) {
      const body: Record<string, unknown> = {
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.5,
        max_completion_tokens: 1024,
        top_p: 1,
        stream: true,
      };
      if (usesReasoningEffort(modelName)) {
        body.reasoning_effort = "low";
      }

      const stream = (await groq.chat.completions.create(
        body as unknown as Parameters<Groq["chat"]["completions"]["create"]>[0],
      )) as AsyncIterable<{
        choices: Array<{ delta?: { content?: string | null } }>;
      }>;

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield { type: "delta" as const, text };
      }
    };

    try {
      try {
        for await (const event of runStream(primaryModel)) {
          yield event;
        }
      } catch (primaryError) {
        this.logger.warn(
          `Modelo ${primaryModel} no disponible, usando ${fallbackModel}`,
        );
        modelUsed = fallbackModel;
        for await (const event of runStream(fallbackModel)) {
          yield event;
        }
      }
      yield { type: "done", model: modelUsed };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Groq stream error: ${msg}`);
      yield { type: "error", message: msg };
    }
  }

  private buildSystemPrompt(
    perfil: PerfilEmpresa,
    resumen: ResumenOperativo,
    warnings: AuditWarning[],
    articles: Awaited<ReturnType<FiscalKnowledgeService["search"]>>,
    mensajeUsuario: string,
  ): string {
    const articulosTexto =
      articles.length > 0
        ? articles
            .map(
              (a, i) =>
                `${i + 1}. [${a.leyLabel} · Art. ${a.articulo}] (similitud ${(a.similarity * 100).toFixed(0)}%)\n${a.content.slice(0, 500)}`,
            )
            .join("\n\n")
        : "No se recuperaron artículos en la base vectorial. Indica al cliente que el equipo debe ejecutar la carga de leyes si aún no está hecha.";

    const alertasTexto =
      warnings.length > 0
        ? warnings
            .map(
              (w, i) =>
                `${i + 1}. [${w.severity.toUpperCase()}] ${w.title}: ${w.message}${w.accionMarfyl ? ` Acción MARFYL: ${w.accionMarfyl}` : ""}`,
            )
            .join("\n")
        : "Sin anomalías críticas detectadas por las reglas automáticas.";

    return `Eres el Auditor Fiscal y Asesor de MARFYL. Tienes acceso a artículos del COT y leyes recuperados, al perfil de la empresa y a sus alertas operativas actuales.

PERFIL EMPRESA:
- RIF: ${perfil.RIF}
- Contribuyente especial: ${perfil.esEspecial ? "Sí" : "No"}
- Actividad: ${perfil.actividadPrincipal}
- Tipo facturación: ${perfil.tipoFacturacion}

RESUMEN OPERATIVO (mes actual):
- Total facturado: USD ${resumen.totalFacturadoMes}
- Pagos divisas efectivo: USD ${resumen.pagosDivisasEfectivo}
- IGTF recaudado: USD ${resumen.igtfRecaudado}
- Última declaración IVA: ${resumen.ultimaDeclaracionIVA ? new Date(resumen.ultimaDeclaracionIVA as string | Date).toLocaleDateString("es-VE") : "sin registro"}
- Facturas sin máquina fiscal: ${resumen.facturasSinMaquinaFiscal}

ALERTAS AUTOMÁTICAS DEL SISTEMA:
${alertasTexto}

ARTÍCULOS LEGALES RECUPERADOS (RAG):
${articulosTexto}

COMPORTAMIENTO:
- Si el sistema detectó anomalías (IGTF, máquinas fiscales o plazos), tu prioridad absoluta es iniciar la respuesta advirtiéndole al cliente de forma empática y clara: "Revisando tu empresa, detecté un riesgo en..."
- Traduce los artículos densos a lenguaje sencillo para un comerciante venezolano.
- Explica CUÁNTO podría ser la multa recordando que el COT actual indexa sanciones a la moneda de mayor valor del BCV (no a UT).
- Indica CÓMO solventarlo dentro de MARFYL cuando aplique.
- Si el usuario hizo una pregunta específica${mensajeUsuario ? `: "${mensajeUsuario}"` : ""}, respóndela justo después del estado de salud fiscal.
- No inventes artículos: cita solo los recuperados arriba.
- Tono: profesional, empático, español venezolano (RIF, IVA, SENIAT).`;
  }
}
