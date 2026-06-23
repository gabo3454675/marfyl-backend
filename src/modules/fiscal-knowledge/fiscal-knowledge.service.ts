import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  EMBEDDING_DIMENSIONS,
  generarEmbeddingGratuito,
  resolveHuggingFaceApiKey,
} from "./generar-embedding-gratuito";
import { FISCAL_LEY_LABELS } from "./fiscal-knowledge.constants";

export interface FiscalKnowledgeSearchHit {
  ley: string;
  leyLabel: string;
  articulo: number;
  chunkIndex: number;
  titulo: string | null;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

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

  async search(
    query: string,
    options?: { ley?: string; limit?: number },
  ): Promise<FiscalKnowledgeSearchHit[]> {
    const q = query.trim();
    if (!q) return [];

    if (!resolveHuggingFaceApiKey()) {
      throw new ServiceUnavailableException(
        "Base de conocimiento fiscal no disponible: configure HUGGINGFACE_API_KEY.",
      );
    }

    const limit = Math.min(Math.max(options?.limit ?? 5, 1), 10);
    const leyFilter = options?.ley?.trim().toUpperCase() || null;

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
      limit,
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
