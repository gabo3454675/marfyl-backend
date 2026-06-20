-- Creación de la tabla de conocimiento estratégico para Marfyl (Asesor Fiscal Proactivo)
-- Usa pgvector con embeddings de 1024 dimensiones (Cohere Multilingual)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS marfyl_conocimiento_estrategico (
  id SERIAL PRIMARY KEY,
  fuente TEXT NOT NULL,
  categoria VARCHAR(255) NOT NULL,
  articulo_seccion VARCHAR(255),
  contenido_legal TEXT NOT NULL,
  explicacion_simplificada TEXT,
  embedding vector(1024) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marfyl_conocimiento_estrategico_categoria
  ON marfyl_conocimiento_estrategico (categoria);

CREATE INDEX IF NOT EXISTS idx_marfyl_conocimiento_estrategico_fuente
  ON marfyl_conocimiento_estrategico (fuente);

CREATE INDEX IF NOT EXISTS idx_marfyl_conocimiento_estrategico_embedding_hnsw
  ON marfyl_conocimiento_estrategico
  USING hnsw (embedding vector_cosine_ops);
