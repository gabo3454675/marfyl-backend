import path from "node:path";
import { Pool } from "pg";
import { vectorToPgLiteral } from "../../src/modules/fiscal-knowledge/embedding-client";
import type { FiscalArticleChunk } from "../../src/modules/fiscal-knowledge/article-chunker";

export function createPgPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

export async function knowledgeTableExists(pool: Pool): Promise<boolean> {
  const res = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'marfyl_knowledge_embeddings'
    ) AS exists
  `);
  return Boolean(res.rows[0]?.exists);
}

export async function countByLey(pool: Pool, ley: string): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM marfyl_knowledge_embeddings WHERE ley = $1`,
    [ley],
  );
  return Number(res.rows[0]?.count ?? 0);
}

export async function deleteByLey(pool: Pool, ley: string): Promise<number> {
  const res = await pool.query(
    `DELETE FROM marfyl_knowledge_embeddings WHERE ley = $1`,
    [ley],
  );
  return res.rowCount ?? 0;
}

export async function articleExists(
  pool: Pool,
  ley: string,
  articulo: number,
  chunkIndex: number,
): Promise<boolean> {
  const res = await pool.query(
    `
    SELECT 1 FROM marfyl_knowledge_embeddings
    WHERE ley = $1 AND articulo = $2 AND chunk_index = $3
    LIMIT 1
    `,
    [ley, articulo, chunkIndex],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function insertArticleEmbedding(
  pool: Pool,
  chunk: FiscalArticleChunk,
  embedding: number[],
  sourceFile: string,
): Promise<void> {
  const vectorLiteral = vectorToPgLiteral(embedding);
  await pool.query(
    `
    INSERT INTO marfyl_knowledge_embeddings (
      ley, articulo, chunk_index, titulo, content, metadata, embedding, source_file
    ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector, $8)
    ON CONFLICT (ley, articulo, chunk_index)
    DO UPDATE SET
      titulo = EXCLUDED.titulo,
      content = EXCLUDED.content,
      metadata = EXCLUDED.metadata,
      embedding = EXCLUDED.embedding,
      source_file = EXCLUDED.source_file,
      updated_at = NOW()
    `,
    [
      chunk.ley,
      chunk.articulo,
      chunk.chunkIndex,
      chunk.titulo,
      chunk.content,
      JSON.stringify(chunk.metadata),
      vectorLiteral,
      sourceFile,
    ],
  );
}

export function resolveKnowledgeDir(cwd = process.cwd()): string {
  const configured =
    process.env.FISCAL_KNOWLEDGE_DIR?.trim() ||
    process.env.FISCAL_KNOWLEDGE_PATH?.trim();
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.join(cwd, configured);
  }
  const candidates = [
    path.join(cwd, "conocimiento fiscal"),
    path.join(cwd, "conocimiento_fiscal"),
  ];
  return candidates[0];
}
