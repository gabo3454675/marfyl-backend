import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { InternalAuthGuard } from "../../common/guards/internal-auth.guard";
import { OrganizationGuard } from "../../common/guards/organization.guard";
import { FiscalKnowledgeService } from "./fiscal-knowledge.service";
import {
  FiscalKnowledgeSearchHitDto,
  FiscalKnowledgeSearchQueryDto,
  FiscalKnowledgeSearchResponseDto,
} from "./fiscal-knowledge.dto";
import type { RankedFiscalHit } from "./fiscal-search-rerank";

/**
 * Controlador S2S para búsqueda semántica sobre la base de conocimiento
 * fiscal venezolana (pgvector). Expone `GET /api/fiscal-knowledge/search`
 * para el agente Python (TASK-010c, Fase 1).
 *
 * Guards (ADR-001):
 * - `InternalAuthGuard`: auth service-to-service con `X-Internal-Secret`.
 *   Solo el agente Python puede consumir este endpoint (no JWT frontend).
 * - `OrganizationGuard`: tenant isolation. Valida membresía real del
 *   `X-User-Id` en la organización indicada por `X-Organization-Id`.
 *
 * El endpoint reutiliza `FiscalKnowledgeService.searchSemantic` (embeddings
 * pgvector ya existentes + rewrite/rerank) y mapea el resultado a un DTO
 * estable que NO expone detalles internos (`parsed`, `chunkIndex`,
 * `metadata`). La señal `confident` permite al agente degradar graciosamente
 * cuando la base no tiene respuesta confiable.
 */
@Controller("fiscal-knowledge")
@UseGuards(InternalAuthGuard, OrganizationGuard)
export class FiscalKnowledgeController {
  constructor(
    private readonly fiscalKnowledgeService: FiscalKnowledgeService,
  ) {}

  @Get("search")
  async search(
    @Query() query: FiscalKnowledgeSearchQueryDto,
  ): Promise<FiscalKnowledgeSearchResponseDto> {
    const result = await this.fiscalKnowledgeService.searchSemantic(query.q, {
      limit: query.limit,
    });

    return {
      hits: result.hits.map(mapHit),
      confident: result.confident,
    };
  }
}

function mapHit(hit: RankedFiscalHit): FiscalKnowledgeSearchHitDto {
  return {
    ley: hit.ley,
    leyLabel: hit.leyLabel,
    articulo: hit.articulo,
    titulo: hit.titulo,
    content: hit.content,
    similarity: hit.similarity,
    rerankScore: hit.rerankScore,
  };
}
