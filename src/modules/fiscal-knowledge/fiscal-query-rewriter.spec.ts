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

  it("prioriza RIVA sobre LIVA en reglamento del IVA", () => {
    const parsed = rewriteFiscalQuery(
      "reglamento de la ley del IVA momento en que nace la obligación tributaria",
    );
    expect(parsed.ley).toBe("RIVA");
  });

  it("detecta RET_IVA_2025 por providencia SNAT 2025", () => {
    const parsed = rewriteFiscalQuery(
      "providencia SNAT 2025 000054 agentes de retención IVA personas naturales",
    );
    expect(parsed.ley).toBe("RET_IVA_2025");
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

  it("boost léxico favorece contenido con keywords de la consulta", () => {
    const hits = [
      baseHit({
        ley: "LIVA",
        articulo: 72,
        content: "Artículo 72. Entrada en vigencia de la reforma...",
        similarity: 0.74,
      }),
      baseHit({
        ley: "LIVA",
        articulo: 5,
        content:
          "Artículo 5. Son contribuyentes ordinarios de este impuesto los importadores habituales...",
        similarity: 0.7,
      }),
    ];
    const ranked = rerankFiscalHits(
      hits,
      {
        ley: "LIVA",
        queryText: "quiénes son contribuyentes ordinarios del IVA",
      },
      2,
    );
    expect(ranked[0]!.articulo).toBe(5);
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
