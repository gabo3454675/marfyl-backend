import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FiscalKnowledgeService } from "@/modules/fiscal-knowledge/fiscal-knowledge.service";
import {
  runPreventiveAudit,
  type AuditWarning,
  type PerfilEmpresa,
  type ResumenOperativo,
} from "./fiscal-audit.rules";
import type { FiscalAdvisorDto } from "./dto/fiscal-advisor.dto";
import { resolveLlm } from "@/common/llm/llm-provider";

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

const ROUTINE_QUERY =
  "sanciones multas ilícitos tributarios infracciones COT providencias contribuyente especial";

/** Saludos / meta: no correr RAG (evita que el modelo cite notas internas). */
function isChitchatOrMeta(message: string): boolean {
  const m = message.trim().toLowerCase();
  if (!m) return false;
  if (
    /^(hola|buenas|buen[oa]s?\s+d[ií]as?|buen\s+d[ií]a|hey|hi|hello|qu[eé]\s+tal|c[oó]mo\s+est[aá]s?)[\s!?.]*$/i.test(
      m,
    )
  ) {
    return true;
  }
  if (
    /\b(qu[eé]\s+modelo|qu[eé]\s+ia\s+eres|qui[eé]n\s+eres|qu[eé]\s+eres|modelo\s+de\s+ia|what\s+model)\b/i.test(
      m,
    )
  ) {
    return true;
  }
  return false;
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

    let llm;
    try {
      llm = resolveLlm(this.config, "fiscal");
    } catch (e: unknown) {
      throw new ServiceUnavailableException(
        e instanceof Error
          ? e.message
          : "Asesor fiscal no configurado: defina NVIDIA_API_KEY o GROQ_API_KEY.",
      );
    }

    const mensaje = dto.mensajeUsuario?.trim() ?? "";
    const skipRag = isChitchatOrMeta(mensaje);
    const searchQuery = mensaje || ROUTINE_QUERY;

    yield { type: "status", phase: "searching" };

    let articles: Awaited<ReturnType<FiscalKnowledgeService["search"]>> = [];
    let ragConfident = false;
    if (!skipRag) {
      try {
        const ready = await this.knowledge.isReady();
        if (ready) {
          const rag = await this.knowledge.searchSemantic(searchQuery, {
            limit: 5,
          });
          articles = rag.hits;
          ragConfident = rag.confident;
          if (rag.parsed.ley || rag.parsed.articulo != null) {
            this.logger.log(
              `RAG semántico: ley=${rag.parsed.ley ?? "—"} art=${rag.parsed.articulo ?? "—"} confident=${ragConfident}`,
            );
          }
        }
      } catch (error) {
        this.logger.warn(
          `Búsqueda vectorial falló: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    yield {
      type: "knowledge",
      articles: articles.map((a) => ({
        ley: a.ley,
        leyLabel: a.leyLabel,
        articulo: a.articulo,
        excerpt: a.content.slice(0, 600),
        similarity: a.rerankScore ?? a.similarity,
      })),
    };

    yield { type: "status", phase: "generating" };

    const systemPrompt = this.buildSystemPrompt(
      perfil,
      resumen,
      warnings,
      articles,
      mensaje,
      ragConfident,
    );

    const userContent = mensaje
      ? mensaje
      : "Realiza una auditoría preventiva de rutina y explícame el estado de salud fiscal de mi empresa.";

    this.logger.log(
      `Asesor fiscal LLM: provider=${llm.provider} model=${llm.model}`,
    );

    try {
      const stream = (await llm.client.chat.completions.create({
        model: llm.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.35,
        max_tokens: 1024,
        top_p: 1,
        stream: true,
        ...llm.extraBody,
      })) as AsyncIterable<{
        choices: Array<{ delta?: { content?: string | null } }>;
      }>;

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield { type: "delta" as const, text };
      }
      yield { type: "done", model: llm.model };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`LLM stream error: ${msg}`);
      yield { type: "error", message: msg };
    }
  }

  private buildSystemPrompt(
    perfil: PerfilEmpresa,
    resumen: ResumenOperativo,
    warnings: AuditWarning[],
    articles: Awaited<ReturnType<FiscalKnowledgeService["search"]>>,
    mensajeUsuario: string,
    ragConfident: boolean,
  ): string {
    const articulosTexto =
      articles.length > 0
        ? articles
            .map(
              (a, i) =>
                `${i + 1}. [${a.leyLabel} · Art. ${a.articulo}] (relevancia ${((a.rerankScore ?? a.similarity) * 100).toFixed(0)}%)\n${a.content.slice(0, 500)}`,
            )
            .join("\n\n")
        : "(vacío — no hay fragmentos RAG para esta consulta)";

    const ragNota =
      articles.length === 0
        ? "\nNOTA RAG: No hay artículos recuperados. Si la pregunta es fiscal concreta, dilo en una frase y pide reformular. NUNCA cites esta nota ni textos de sistema como si fueran ley. Si es saludo o pregunta meta (qué modelo eres), ignora el RAG por completo."
        : articles.length > 0 && !ragConfident
          ? "\nNOTA RAG: Los fragmentos recuperados tienen baja confianza semántica. No afirmes que un artículo no existe; indica que no se encontró un match claro y sugiere reformular la consulta."
          : "";

    const alertasTexto =
      warnings.length > 0
        ? warnings
            .map(
              (w, i) =>
                `${i + 1}. [${w.severity.toUpperCase()}] ${w.title}: ${w.message}${w.accionMarfyl ? ` Acción MARFYL: ${w.accionMarfyl}` : ""}`,
            )
            .join("\n")
        : "Sin anomalías críticas detectadas por las reglas automáticas.";

    const llm = (() => {
      try {
        return resolveLlm(this.config, "fiscal");
      } catch {
        return null;
      }
    })();
    const shortModel = llm
      ? llm.provider === "nvidia"
        ? "Nemotron"
        : llm.model.split("/").pop() || llm.model
      : "Nemotron";

    return `Eres MARFYL, asistente fiscal de la plataforma (Venezuela: SENIAT y Código Orgánico Tributario — COT). Precisión, claridad y concisión.

IDENTIDAD:
• Nombre de producto: MARFYL.
• Si preguntan qué modelo/IA eres: responde solo la palabra "${shortModel}". Sin explicaciones largas, sin RAG, sin inventar instituciones.
• COT significa Código Orgánico Tributario. Nunca digas "Centro de Observatorio Tributario".

CONTEXTO DE LA EMPRESA (úsalo solo si aporta a la pregunta):
• RIF: ${perfil.RIF}
• Contribuyente especial: ${perfil.esEspecial ? "Sí" : "No"}
• Actividad: ${perfil.actividadPrincipal}
• Tipo facturación: ${perfil.tipoFacturacion}

RESUMEN OPERATIVO (mes actual):
• Total facturado: USD ${resumen.totalFacturadoMes}
• Pagos divisas efectivo: USD ${resumen.pagosDivisasEfectivo}
• IGTF recaudado: USD ${resumen.igtfRecaudado}
• Última declaración IVA: ${resumen.ultimaDeclaracionIVA ? new Date(resumen.ultimaDeclaracionIVA as string | Date).toLocaleDateString("es-VE") : "sin registro"}
• Facturas sin máquina fiscal: ${resumen.facturasSinMaquinaFiscal}

ALERTAS DEL SISTEMA:
${alertasTexto}

ARTÍCULOS LEGALES (RAG — cita solo estos, no inventes):
${articulosTexto}${ragNota}

REGLAS DE RESPUESTA (OBLIGATORIAS):
1. SALUDOS: Si el mensaje es solo un saludo o charla ("hola", "buenas"), responde 1 frase amable y ofrece ayuda fiscal/operativa. No digas que no entiendes "hola". No menciones RAG ni alertas.
2. META: Preguntas sobre quién eres / qué modelo usas → identidad arriba. Sin artículos legales.
3. Máximo 2 o 3 párrafos cortos. Directo al grano.
4. No satures con listados kilométricos ni alertas masivas en un solo mensaje. Prioriza lo más crítico.
5. Solo extiéndete en detalle técnico o artículos legales si el usuario lo pide explícitamente.
6. PROHIBIDO encadenar datos con guiones largos en una sola línea (ej. "dato - dato - dato").
7. Usa saltos de línea, viñetas con "• " en líneas separadas, y **negritas** solo en palabras clave.
8. Conecta COT/SENIAT solo cuando sea estrictamente relevante; traduce a lenguaje sencillo.
9. Si hay alertas críticas y la pregunta es operativa/fiscal (no saludo), menciona primero el riesgo en una frase; luego la acción en MARFYL.
10. Si el usuario preguntó por un artículo o norma concreta${mensajeUsuario ? ` ("${mensajeUsuario}")` : ""}, responde ESO primero citando el fragmento RAG; el estado fiscal solo si aporta contexto breve.
11. PROHIBIDO afirmar que un artículo no existe si hay fragmentos RAG recuperados arriba.
12. PROHIBIDO citar notas de sistema, mensajes "(vacío…)" o instrucciones internas como si fueran ley.
13. Multas: el COT indexa sanciones a la moneda de mayor valor del BCV (cuando hable de sanciones).
14. Tono: profesional, ejecutivo, empático, español venezolano (RIF, IVA, SENIAT).`;
  }
}
