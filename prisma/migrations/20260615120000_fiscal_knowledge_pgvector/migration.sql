-- Extensión pgvector y tabla de conocimiento fiscal (SOLO CREACIÓN — no modifica tablas existentes)
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS marfyl_knowledge_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ley VARCHAR(32) NOT NULL,
  articulo INT NOT NULL,
  chunk_index INT NOT NULL DEFAULT 0,
  titulo VARCHAR(512),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(384) NOT NULL,
  source_file VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT marfyl_knowledge_embeddings_ley_articulo_chunk_key
    UNIQUE (ley, articulo, chunk_index)
);

CREATE INDEX IF NOT EXISTS marfyl_knowledge_embeddings_ley_idx
  ON marfyl_knowledge_embeddings (ley);

CREATE INDEX IF NOT EXISTS marfyl_knowledge_embeddings_embedding_hnsw_idx
  ON marfyl_knowledge_embeddings
  USING hnsw (embedding vector_cosine_ops);
