import { FISCAL_LEY_LABELS } from "./fiscal-knowledge.constants";

export interface ParsedFiscalQuery {
  originalQuery: string;
  /** Texto optimizado para embedding semántico */
  embeddingQuery: string;
  ley: string | null;
  articulo: number | null;
}

const ARTICULO_RE =
  /\b(?:art[ií]culo|art\.?)\s*(?:n[°º.]?\s*)?(\d{1,4})\b/i;

/** Alias de normas que el usuario puede mencionar en lenguaje natural */
const LEY_ALIASES: Array<{ ley: string; patterns: RegExp[] }> = [
  {
    ley: "COT",
    patterns: [
      /\bcot\b/i,
      /c[oó]digo\s+org[aá]nico\s+tributario/i,
      /c[oó]digo\s+tributario/i,
    ],
  },
  {
    ley: "LIVA",
    patterns: [/\bliva\b/i, /\biva\b/i, /impuesto\s+al\s+valor\s+agregado/i],
  },
  {
    ley: "RIVA",
    patterns: [/\briva\b/i, /reglamento\s+(?:de\s+la\s+)?ley\s+(?:del\s+)?iva/i],
  },
  {
    ley: "LISLR",
    patterns: [/\blislr\b/i, /ley\s+(?:del\s+)?islr/i, /ley\s+impuesto\s+sobre\s+la\s+renta/i],
  },
  {
    ley: "RISLR",
    patterns: [/\brislr\b/i, /reglamento\s+(?:de\s+la\s+)?(?:ley\s+)?islr/i],
  },
  {
    ley: "LIGTF",
    patterns: [/\bligtf\b/i, /\bigtf\b/i, /gran\s+transacciones\s+financieras/i],
  },
  {
    ley: "PROV_0071",
    patterns: [/\bprov(?:idencia)?[\s._-]*0*071\b/i, /\b0071\b/, /providencia\s+0071/i],
  },
  {
    ley: "PROV_SNAT_0141",
    patterns: [
      /\bprov(?:idencia)?[\s._-]*snat[\s._-]*0*141\b/i,
      /\b0141\b/,
      /providencia\s+0141/i,
    ],
  },
  {
    ley: "CALENDARIO_2026",
    patterns: [/calendario\s+fiscal/i, /calendario\s+tributario/i],
  },
];

function detectLey(query: string): string | null {
  for (const entry of LEY_ALIASES) {
    if (entry.patterns.some((re) => re.test(query))) {
      return entry.ley;
    }
  }
  return null;
}

function detectArticulo(query: string): number | null {
  const match = query.match(ARTICULO_RE);
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Reescribe consultas meta ("qué dice el artículo 120") hacia texto
 * más cercano al lenguaje de los chunks indexados.
 */
export function rewriteFiscalQuery(raw: string): ParsedFiscalQuery {
  const originalQuery = raw.trim();
  const ley = detectLey(originalQuery);
  const articulo = detectArticulo(originalQuery);

  const parts: string[] = [];

  if (ley) {
    parts.push(FISCAL_LEY_LABELS[ley] ?? ley);
    parts.push(ley);
  }

  if (articulo != null) {
    parts.push(`Artículo ${articulo}`);
    parts.push(`Art. ${articulo}`);
  }

  parts.push("disposición legal normativa fiscal Venezuela SENIAT");

  if (!ley && !articulo) {
    parts.unshift(originalQuery);
  } else if (originalQuery.length > 12) {
    parts.push(originalQuery);
  }

  const embeddingQuery = [...new Set(parts.filter(Boolean))].join(" ").trim();

  return {
    originalQuery,
    embeddingQuery,
    ley,
    articulo,
  };
}

/** Texto enriquecido para indexar embeddings (re-ingest futuro). */
export function buildChunkEmbeddingText(input: {
  ley: string;
  articulo: number;
  titulo: string | null;
  content: string;
}): string {
  const label = FISCAL_LEY_LABELS[input.ley] ?? input.ley;
  const header = [
    `[${input.ley} · ${label} · Artículo ${input.articulo}]`,
    input.titulo ? input.titulo : null,
  ]
    .filter(Boolean)
    .join(" ");
  return `${header}\n${input.content}`.trim();
}
