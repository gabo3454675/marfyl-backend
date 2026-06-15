-- Ajuste seguro de dimensión vectorial si la tabla ya existía con 1024/1536 dims
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'marfyl_knowledge_embeddings'
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM marfyl_knowledge_embeddings LIMIT 1) THEN
      ALTER TABLE marfyl_knowledge_embeddings
        ALTER COLUMN embedding TYPE vector(384);
    END IF;
  END IF;
END $$;
