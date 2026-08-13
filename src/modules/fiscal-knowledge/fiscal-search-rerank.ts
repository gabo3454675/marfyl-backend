import type { FiscalKnowledgeSearchHit } from "./fiscal-knowledge.service";

const LEY_MATCH_BOOST = 0.18;
const ARTICULO_MATCH_BOOST = 0.32;
const BOTH_MATCH_BOOST = 0.12;
const ARTICULO_MISMATCH_PENALTY = 0.08;
const KEYWORD_HIT_BOOST = 0.08;
const KEYWORD_HIT_CAP = 0.24;

export interface FiscalSearchHints {
  ley?: string | null;
  articulo?: number | null;
  /** Consulta original (para boost léxico suave sobre el contenido) */
  queryText?: string | null;
}

export interface RankedFiscalHit extends FiscalKnowledgeSearchHit {
  /** Puntuación tras rerank semántico + metadata */
  rerankScore: number;
}

const STOP = new Set([
  "de",
  "del",
  "la",
  "las",
  "el",
  "los",
  "un",
  "una",
  "y",
  "o",
  "en",
  "por",
  "para",
  "con",
  "que",
  "al",
  "se",
  "su",
  "sus",
  "es",
  "son",
  "como",
  "esta",
  "este",
  "ley",
  "articulo",
  "artículo",
  "art",
  "venezuela",
  "seniat",
]);

function queryKeywords(queryText: string | null | undefined): string[] {
  if (!queryText?.trim()) return [];
  const tokens = queryText
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9%]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
  return [...new Set(tokens)].slice(0, 12);
}

export function rerankFiscalHits(
  hits: FiscalKnowledgeSearchHit[],
  hints: FiscalSearchHints,
  limit: number,
): RankedFiscalHit[] {
  const leyHint = hints.ley?.trim().toUpperCase() || null;
  const articuloHint =
    typeof hints.articulo === "number" && hints.articulo > 0
      ? hints.articulo
      : null;
  const keywords = queryKeywords(hints.queryText);

  const ranked = hits.map((hit) => {
    let rerankScore = hit.similarity;

    const leyMatch = leyHint != null && hit.ley === leyHint;
    const articuloMatch =
      articuloHint != null && hit.articulo === articuloHint;

    if (leyMatch) rerankScore += LEY_MATCH_BOOST;
    if (articuloMatch) rerankScore += ARTICULO_MATCH_BOOST;
    if (leyMatch && articuloMatch) rerankScore += BOTH_MATCH_BOOST;

    if (
      articuloHint != null &&
      hit.articulo > 0 &&
      hit.articulo !== articuloHint
    ) {
      rerankScore -= ARTICULO_MISMATCH_PENALTY;
    }

    if (keywords.length > 0) {
      const hay = `${hit.titulo ?? ""} ${hit.content}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
      let hitsKw = 0;
      for (const kw of keywords) {
        if (hay.includes(kw)) hitsKw += 1;
      }
      if (hitsKw > 0) {
        rerankScore += Math.min(KEYWORD_HIT_CAP, hitsKw * KEYWORD_HIT_BOOST);
      }
    }

    return { ...hit, rerankScore };
  });

  ranked.sort((a, b) => b.rerankScore - a.rerankScore);

  return ranked.slice(0, Math.max(1, limit));
}

/** Similitud mínima aceptable tras rerank para considerar el hit confiable. */
export const FISCAL_SEARCH_MIN_RERANK_SCORE = 0.42;

export function hasConfidentFiscalHits(hits: RankedFiscalHit[]): boolean {
  if (hits.length === 0) return false;
  return hits[0]!.rerankScore >= FISCAL_SEARCH_MIN_RERANK_SCORE;
}
