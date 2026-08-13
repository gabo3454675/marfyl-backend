import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from "@nestjs/common";
import { InternalOrJwtAuthGuard } from "@/common/guards/internal-or-jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { FiscalKnowledgeService } from "./fiscal-knowledge.service";

/**
 * Endpoint S2S / JWT para RAG fiscal (agente Python + front).
 * Contrato estable: `{ hits, confident }` — usado por
 * `GET /api/fiscal-knowledge/search` en agent-marfyl.
 */
@Controller("fiscal-knowledge")
@UseGuards(InternalOrJwtAuthGuard, OrganizationGuard)
export class FiscalKnowledgeController {
  constructor(private readonly knowledge: FiscalKnowledgeService) {}

  @Get("search")
  async search(
    @Query("q") q?: string,
    @Query("query") query?: string,
    @Query("limit") limitRaw?: string,
    @Query("ley") ley?: string,
    @Query("articulo") articuloRaw?: string,
  ) {
    const text = String(q ?? query ?? "").trim();
    if (!text) {
      throw new BadRequestException("q (o query) es requerido");
    }

    const ready = await this.knowledge.isReady();
    if (!ready) {
      return { hits: [], confident: false, ready: false };
    }

    const limit = Number.parseInt(String(limitRaw ?? "5"), 10);
    const articulo = articuloRaw
      ? Number.parseInt(String(articuloRaw), 10)
      : undefined;

    const rag = await this.knowledge.searchSemantic(text, {
      ley: ley?.trim() || undefined,
      articulo: Number.isFinite(articulo) ? articulo : undefined,
      limit: Number.isFinite(limit) ? limit : 5,
    });

    return {
      hits: rag.hits.map((h) => ({
        ley: h.ley,
        leyLabel: h.leyLabel,
        articulo: h.articulo,
        chunkIndex: h.chunkIndex,
        titulo: h.titulo,
        content: h.content.slice(0, 2500),
        similarity: Math.round(h.similarity * 1000) / 1000,
        rerankScore:
          Math.round((h.rerankScore ?? h.similarity) * 1000) / 1000,
      })),
      confident: rag.confident,
      parsed: {
        ley: rag.parsed.ley,
        articulo: rag.parsed.articulo,
        embeddingQuery: rag.parsed.embeddingQuery,
      },
    };
  }
}
