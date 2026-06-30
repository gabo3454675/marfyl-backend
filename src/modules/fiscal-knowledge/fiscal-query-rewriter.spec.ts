import {
  buildChunkEmbeddingText,
  rewriteFiscalQuery,
} from "./fiscal-query-rewriter";
import { rerankFiscalHits } from "./fiscal-search-rerank";
import type { FiscalKnowledgeSearchHit } from "./fiscal-knowledge.service";

describe("rewriteFiscalQuery", () => {
  it("detecta COT y artículo 120", () => {
    const parsed = rewriteFiscalQuery("que dice el articulo 120 del COT");
    expect(parsed.ley).toBe("COT");
    expect(parsed.articulo).toBe(120);
    expect(parsed.embeddingQuery).toContain("Artículo 120");
    expect(parsed.embeddingQuery).toContain("COT");
  });

  it("detecta LIGTF por alias IGTF", () => {
    const parsed = rewriteFiscalQuery("artículo 17 IGTF");
    expect(parsed.ley).toBe("LIGTF");
    expect(parsed.articulo).toBe(17);
  });

  it("conserva la pregunta original cuando no hay señales", () => {
    const parsed = rewriteFiscalQuery("sanción por no retener ISLR");
    expect(parsed.embeddingQuery).toContain("sanción por no retener ISLR");
  });
});

describe("rerankFiscalHits", () => {
  const baseHit = (
    partial: Partial<FiscalKnowledgeSearchHit>,
  ): FiscalKnowledgeSearchHit => ({
    ley: "COT",
    leyLabel: "Código Orgánico Tributario",
    articulo: 30,
    chunkIndex: 0,
    titulo: null,
    content: "Artículo 30...",
    metadata: {},
    similarity: 0.62,
    ...partial,
  });

  it("prioriza artículo y ley coincidentes", () => {
    const hits = [
      baseHit({ articulo: 185, similarity: 0.68 }),
      baseHit({
        articulo: 120,
        titulo: "Constituyen indicios de defraudación tributaria",
        content: "Artículo 120...",
        similarity: 0.55,
      }),
    ];

    const ranked = rerankFiscalHits(
      hits,
      { ley: "COT", articulo: 120 },
      2,
    );

    expect(ranked[0]!.articulo).toBe(120);
    expect(ranked[0]!.rerankScore).toBeGreaterThan(ranked[1]!.rerankScore);
  });
});

describe("buildChunkEmbeddingText", () => {
  it("incluye metadatos de ley y artículo", () => {
    const text = buildChunkEmbeddingText({
      ley: "COT",
      articulo: 120,
      titulo: "Indicios de defraudación",
      content: "Artículo 120. Constituyen indicios...",
    });
    expect(text).toContain("[COT · Código Orgánico Tributario · Artículo 120]");
    expect(text).toContain("Indicios de defraudación");
  });
});
