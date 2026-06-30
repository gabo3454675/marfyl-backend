import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  EMBEDDING_DIMENSIONS,
  generarEmbeddingGratuito,
  resolveHuggingFaceApiKey,
} from "./generar-embedding-gratuito";
import { FISCAL_LEY_LABELS } from "./fiscal-knowledge.constants";
import {
  rewriteFiscalQuery,
  type ParsedFiscalQuery,
} from "./fiscal-query-rewriter";
import {
  hasConfidentFiscalHits,
  rerankFiscalHits,
  type RankedFiscalHit,
} from "./fiscal-search-rerank";

export interface FiscalKnowledgeSearchHit {
  ley: string;
  leyLabel: string;
  articulo: number;
  chunkIndex: number;
  titulo: string | null;
  content: string;
  metadata: Record<string, unknown>;
  /** Similitud coseno del vector (pre-rerank) */
  similarity: number;
  /** Puntuación final tras rerank semántico + metadata */
  rerankScore?: number;
}

export interface FiscalKnowledgeSearchOptions {
  ley?: string;
  articulo?: number;
  /** Resultados finales devueltos al caller (default 5, máx 10) */
  limit?: number;
  /** Candidatos vectoriales antes del rerank (default 20, máx 30) */
  candidateLimit?: number;
  /** Desactiva rewrite/rerank (solo vector puro) */
  rawVector?: boolean;
}

export interface FiscalKnowledgeSearchResult {
  hits: RankedFiscalHit[];
  parsed: ParsedFiscalQuery;
  confident: boolean;
}

const DEFAULT_FINAL_LIMIT = 5;
const DEFAULT_CANDIDATE_LIMIT = 20;

@Injectable()
export class FiscalKnowledgeService {
  private readonly logger = new Logger(FiscalKnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async isReady(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM marfyl_knowledge_embeddings
      `;
      return Number(rows[0]?.count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Búsqueda semántica con query rewrite + pool amplio + rerank por ley/artículo.
   */
  async searchSemantic(
    query: string,
    options?: FiscalKnowledgeSearchOptions,
  ): Promise<FiscalKnowledgeSearchResult> {
    const parsed = rewriteFiscalQuery(query);
    const finalLimit = Math.min(Math.max(options?.limit ?? DEFAULT_FINAL_LIMIT, 1), 10);
    const candidateLimit = Math.min(
      Math.max(options?.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT, finalLimit),
      30,
    );

    const leyHint = options?.ley?.trim().toUpperCase() || parsed.ley;
    const articuloHint = options?.articulo ?? parsed.articulo;

    if (options?.rawVector) {
      const hits = await this.vectorSearch(parsed.originalQuery, {
        leyFilter: leyHint,
        limit: finalLimit,
      });
      const ranked = hits.map((h) => ({ ...h, rerankScore: h.similarity }));
      return {
        hits: ranked,
        parsed,
        confident: hasConfidentFiscalHits(ranked),
      };
    }

    const embeddingQuery = parsed.embeddingQuery;
    this.logger.debug(
      `RAG rewrite: "${parsed.originalQuery}" → "${embeddingQuery}"` +
        (leyHint ? ` [ley=${leyHint}]` : "") +
        (articuloHint != null ? ` [art=${articuloHint}]` : ""),
    );

    const candidates = await this.vectorSearch(embeddingQuery, {
      leyFilter: leyHint,
      limit: candidateLimit,
    });

    const ranked = rerankFiscalHits(
      candidates,
      { ley: leyHint, articulo: articuloHint },
      finalLimit,
    );

    return {
      hits: ranked,
      parsed,
      confident: hasConfidentFiscalHits(ranked),
    };
  }

  /** Compatibilidad con callers existentes */
  async search(
    query: string,
    options?: { ley?: string; limit?: number; articulo?: number },
  ): Promise<FiscalKnowledgeSearchHit[]> {
    const result = await this.searchSemantic(query, {
      ley: options?.ley,
      articulo: options?.articulo,
      limit: options?.limit,
    });
    return result.hits.map((hit) => ({
      ...hit,
      rerankScore: hit.rerankScore,
    }));
  }

  private async vectorSearch(
    query: string,
    options: { leyFilter?: string | null; limit: number },
  ): Promise<FiscalKnowledgeSearchHit[]> {
    const q = query.trim();
    if (!q) return [];

    if (!resolveHuggingFaceApiKey()) {
      throw new ServiceUnavailableException(
        "Base de conocimiento fiscal no disponible: configure HUGGINGFACE_API_KEY.",
      );
    }

    const leyFilter = options.leyFilter?.trim().toUpperCase() || null;

    const vector = await generarEmbeddingGratuito(q);
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new ServiceUnavailableException(
        `Embedding inválido (${vector.length} dims, se esperan ${EMBEDDING_DIMENSIONS}).`,
      );
    }

    // Validar que todos los valores del vector son numéricos finitos
    const safeVector = vector
      .filter((v) => Number.isFinite(v))
      .map((v) => Number(v.toFixed(8)));

    if (safeVector.length === 0) {
      return [];
    }

    const vectorLiteral = `[${safeVector.join(",")}]`;

    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        ley: string;
        articulo: number;
        chunk_index: number;
        titulo: string | null;
        content: string;
        metadata: Record<string, unknown>;
        similarity: number;
      }>
    >(
      `
      SELECT
        ley,
        articulo,
        chunk_index,
        titulo,
        content,
        metadata,
        1 - (embedding <=> $1::vector) AS similarity
      FROM marfyl_knowledge_embeddings
      WHERE ($2::varchar IS NULL OR ley = $2)
      ORDER BY embedding <=> $1::vector
      LIMIT $3
      `,
      vectorLiteral,
      leyFilter,
      options.limit,
    );

    return rows.map((row) => ({
      ley: row.ley,
      leyLabel: FISCAL_LEY_LABELS[row.ley] ?? row.ley,
      articulo: row.articulo,
      chunkIndex: row.chunk_index,
      titulo: row.titulo,
      content: row.content,
      metadata: row.metadata ?? {},
      similarity: Number(row.similarity),
    }));
  }
}
