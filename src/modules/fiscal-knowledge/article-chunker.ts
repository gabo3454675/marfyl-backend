export interface FiscalArticleChunk {
  ley: string;
  articulo: number;
  chunkIndex: number;
  titulo: string | null;
  content: string;
  metadata: {
    ley: string;
    articulo: number;
    chunkIndex: number;
    titulo: string | null;
    title: string;
    sourceFile: string;
  };
}

// Acepta PDF plano y Markdown (**Artículo 1º.** / Artículo 1.)
const ARTICLE_HEADER_RE =
  /(?:^|\n)\s*(?:\*\*)?(?:Art[ií]culo|ART[IÍ]CULO|Art\.)\s*(\d+)\s*[°º.:]?(?:\*\*)?\.?\s*/gi;

const PARAGRAPH_MARKERS =
  /(?:Parágrafo\s+Único|Parágrafo\s+Primero|Parágrafo\s+Segundo|Parágrafo\s+Tercero|Párrafo\s+Único)/i;

/**
 * Une saltos de línea típicos de PDF sin romper párrafos legales.
 */
export function normalizePdfText(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/([a-záéíóúñ,;:])\n([a-záéíóúñ])/gi, "$1 $2")
    .replace(/([^\n.!?])\n([^\nA-ZÁÉÍÓÚÑ"«(])/g, "$1 $2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTitle(body: string): string | null {
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 8);
  if (!firstLine) return null;
  if (/^Art[ií]culo\s+\d+/i.test(firstLine)) {
    const rest = firstLine.replace(/^Art[ií]culo\s+\d+\s*[°º.:]?\s*/i, "").trim();
    return rest.length > 3 ? rest.slice(0, 500) : null;
  }
  return firstLine.slice(0, 500);
}

function splitLongContent(content: string, maxLen = 3_500): string[] {
  if (content.length <= maxLen) return [content];
  const parts: string[] = [];
  let i = 0;
  while (i < content.length) {
    let end = Math.min(i + maxLen, content.length);
    if (end < content.length) {
      const slice = content.slice(i, end);
      const breakAt = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
      );
      if (breakAt > maxLen * 0.4) end = i + breakAt + 1;
    }
    parts.push(content.slice(i, end).trim());
    i = end;
  }
  return parts.filter(Boolean);
}

function fallbackChunks(
  text: string,
  ley: string,
  title: string,
  sourceFile: string,
): FiscalArticleChunk[] {
  // Chunks más cortos = mejor recall en embeddings 384d
  const parts = splitLongContent(text, 3_500);
  return parts.map((content, idx) => ({
    ley,
    articulo: 0,
    chunkIndex: idx,
    titulo: idx === 0 ? title : `${title} (parte ${idx + 1})`,
    content,
    metadata: {
      ley,
      articulo: 0,
      chunkIndex: idx,
      titulo: idx === 0 ? title : `${title} (parte ${idx + 1})`,
      title,
      sourceFile,
    },
  }));
}

/**
 * Segmenta por encabezados "Artículo N". Parágrafos del mismo artículo permanecen unificados.
 */
export function chunkByArticles(
  rawText: string,
  ley: string,
  title: string,
  sourceFile: string,
): FiscalArticleChunk[] {
  const text = normalizePdfText(rawText);
  if (!text) return [];

  const matches = [...text.matchAll(ARTICLE_HEADER_RE)];
  if (matches.length === 0) {
    return fallbackChunks(text, ley, title, sourceFile);
  }

  const seen = new Map<number, number>();
  const chunks: FiscalArticleChunk[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = match.index ?? 0;
    const end =
      i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
    const articulo = Number.parseInt(match[1], 10);
    if (!Number.isFinite(articulo)) continue;

    let body = text.slice(start, end).trim();
    if (!body) continue;

    // Asegura que párrafos legales no se corten en límites internos
    if (PARAGRAPH_MARKERS.test(body) && body.length < 40 && i + 1 < matches.length) {
      const nextEnd =
        i + 2 < matches.length
          ? (matches[i + 2].index ?? text.length)
          : text.length;
      body = text.slice(start, nextEnd).trim();
      i += 1;
    }

    const prev = seen.get(articulo) ?? 0;
    const chunkIndex = prev;
    const titulo = extractTitle(body);
    const pieces = splitLongContent(body, 3_500);

    for (let p = 0; p < pieces.length; p++) {
      const pieceIndex = chunkIndex + p;
      const pieceTitle =
        pieces.length > 1
          ? `${titulo ?? `Artículo ${articulo}`} (parte ${p + 1})`
          : titulo;
      chunks.push({
        ley,
        articulo,
        chunkIndex: pieceIndex,
        titulo: pieceTitle,
        content: pieces[p]!,
        metadata: {
          ley,
          articulo,
          chunkIndex: pieceIndex,
          titulo: pieceTitle,
          title,
          sourceFile,
        },
      });
    }
    seen.set(articulo, chunkIndex + pieces.length);
  }

  return chunks;
}
