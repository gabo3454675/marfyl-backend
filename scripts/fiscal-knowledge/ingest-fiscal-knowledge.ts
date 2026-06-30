#!/usr/bin/env tsx
/**
 * Ingesta de leyes fiscales venezolanas → PostgreSQL + pgvector
 *
 * Uso:
 *   pnpm ingest:fiscal-knowledge
 *   pnpm ingest:fiscal-knowledge -- --ley=LIVA
 *   pnpm ingest:fiscal-knowledge -- --replace --ley=COT
 *   pnpm ingest:fiscal-knowledge -- --dry-run
 *   pnpm ingest:fiscal-knowledge -- --no-ocr   # solo capa de texto del PDF
 *
 * PDFs escaneados (sin texto seleccionable) usan OCR automático (Tesseract spa).
 *
 * Requiere:
 *   DATABASE_URL, HUGGINGFACE_API_KEY (o HF_TOKEN)
 *   Migración pgvector aplicada: pnpm prisma:deploy
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { assertMarfylDatabaseUrl } from "../../src/common/database-guard";
import { chunkByArticles } from "../../src/modules/fiscal-knowledge/article-chunker";
import { buildChunkEmbeddingText } from "../../src/modules/fiscal-knowledge/fiscal-query-rewriter";
import { generarEmbeddingGratuito, resolveHuggingFaceApiKey } from "../../src/modules/fiscal-knowledge/generar-embedding-gratuito";
import { extractPdfTextWithOcr, terminateOcrWorker } from "../../src/modules/fiscal-knowledge/pdf-extract-ocr";
import { FISCAL_PDF_CATALOG } from "../../src/modules/fiscal-knowledge/fiscal-knowledge.constants";
import {
  articleExists,
  countByLey,
  createPgPool,
  deleteByLey,
  insertArticleEmbedding,
  knowledgeTableExists,
  resolveKnowledgeDir,
} from "./db";

interface CliOptions {
  ley?: string;
  replace: boolean;
  dryRun: boolean;
  noOcr: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { replace: false, dryRun: false, noOcr: false };
  for (const arg of argv) {
    if (arg === "--replace") opts.replace = true;
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg === "--no-ocr") opts.noOcr = true;
    if (arg.startsWith("--ley=")) opts.ley = arg.slice("--ley=".length).toUpperCase();
  }
  return opts;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolvePdfPath(
  knowledgeDir: string,
  entry: (typeof FISCAL_PDF_CATALOG)[number],
): Promise<string | null> {
  const candidates = [entry.file, ...(entry.aliases ?? [])];
  for (const name of candidates) {
    const full = path.join(knowledgeDir, name);
    try {
      await fs.access(full);
      return full;
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl && !opts.dryRun) {
    throw new Error("DATABASE_URL no configurada");
  }
  if (databaseUrl) assertMarfylDatabaseUrl(databaseUrl);

  const hfKey = resolveHuggingFaceApiKey();
  if (!hfKey && !opts.dryRun) {
    throw new Error(
      "HUGGINGFACE_API_KEY (o HF_TOKEN) no configurada — necesaria para embeddings vía Hugging Face",
    );
  }

  const knowledgeDir = resolveKnowledgeDir();
  console.log(`[ingest] Carpeta de PDFs: ${knowledgeDir}`);

  const catalog = opts.ley
    ? FISCAL_PDF_CATALOG.filter((e) => e.ley === opts.ley)
    : FISCAL_PDF_CATALOG;

  if (catalog.length === 0) {
    throw new Error(`No hay PDFs catalogados para ley=${opts.ley}`);
  }

  const pool = opts.dryRun ? null : createPgPool(databaseUrl);
  try {
    if (!opts.dryRun) {
      if (!pool) throw new Error("Pool de base de datos no inicializado");
      if (!(await knowledgeTableExists(pool))) {
        throw new Error(
          "Tabla marfyl_knowledge_embeddings no existe. Ejecute: pnpm prisma:deploy",
        );
      }
    } else {
      console.log("[ingest] Modo dry-run: no se conectará a la base de datos.");
    }

    const hfKey = resolveHuggingFaceApiKey();
    let totalInserted = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const entry of catalog) {
      console.log(`\n[ingest] === ${entry.ley} — ${entry.title} ===`);
      const pdfPath = await resolvePdfPath(knowledgeDir, entry);
      if (!pdfPath) {
        console.warn(
          `[ingest] ⚠ Archivo no encontrado para ${entry.ley} (esperado: ${entry.file})`,
        );
        totalErrors++;
        continue;
      }

      console.log(`[ingest] Leyendo PDF: ${path.basename(pdfPath)}`);

      let text = "";
      let usedOcr = false;
      try {
        if (opts.noOcr) {
          const { extractPdfText } = await import(
            "../../src/modules/fiscal-knowledge/pdf-extract"
          );
          text = await extractPdfText(pdfPath);
        } else {
          const extracted = await extractPdfTextWithOcr(pdfPath, {
            onProgress: (msg) => console.log(`[ingest] ${msg}`),
          });
          text = extracted.text;
          usedOcr = extracted.usedOcr;
          if (usedOcr) {
            console.log(
              `[ingest] OCR completado: ${extracted.pageCount} páginas, ${text.length} caracteres`,
            );
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[ingest] ✗ Error extrayendo PDF (${entry.ley}): ${msg}`);
        totalErrors++;
        continue;
      }

      if (!text.trim()) {
        console.warn(
          `[ingest] ⚠ Sin texto extraíble en ${entry.ley} (¿PDF escaneado sin OCR?)`,
        );
        totalErrors++;
        continue;
      }

      const chunks = chunkByArticles(text, entry.ley, entry.title, path.basename(pdfPath));
      console.log(`[ingest] Artículos/chunks detectados: ${chunks.length}`);

      if (opts.replace && !opts.dryRun && pool) {
        const deleted = await deleteByLey(pool, entry.ley);
        console.log(`[ingest] --replace: eliminados ${deleted} registros previos de ${entry.ley}`);
      } else if (!opts.dryRun && pool) {
        const existing = await countByLey(pool, entry.ley);
        if (existing > 0) {
          console.log(
            `[ingest] Ya existen ${existing} registros de ${entry.ley} (use --replace para reemplazar solo esa ley)`,
          );
        }
      }

      let insertedForDoc = 0;
      let skippedForDoc = 0;

      for (const [idx, chunk] of chunks.entries()) {
        const label = `${entry.ley} art.${chunk.articulo}${chunk.chunkIndex > 0 ? `#${chunk.chunkIndex}` : ""}`;
        try {
          if (!opts.replace && !opts.dryRun && pool) {
            const exists = await articleExists(
              pool,
              chunk.ley,
              chunk.articulo,
              chunk.chunkIndex,
            );
            if (exists) {
              skippedForDoc++;
              if ((idx + 1) % 25 === 0) {
                console.log(`[ingest]   … progreso ${idx + 1}/${chunks.length}`);
              }
              continue;
            }
          }

          if (opts.dryRun) {
            console.log(
              `[ingest] [dry-run] ${label} — ${chunk.content.slice(0, 90).replace(/\s+/g, " ")}…`,
            );
            insertedForDoc++;
            totalInserted++;
            continue;
          }

          const embeddingText = buildChunkEmbeddingText({
            ley: chunk.ley,
            articulo: chunk.articulo,
            titulo: chunk.titulo,
            content: chunk.content,
          });
          const embedding = await generarEmbeddingGratuito(embeddingText, {
            apiKey: hfKey!,
          });
          if (!pool) throw new Error("Pool de base de datos no inicializado");
          await insertArticleEmbedding(pool, chunk, embedding, path.basename(pdfPath));
          insertedForDoc++;
          totalInserted++;

          if (insertedForDoc % 10 === 0 || idx === chunks.length - 1) {
            console.log(
              `[ingest]   ✓ ${insertedForDoc} guardados / ${skippedForDoc} omitidos — último: ${label}`,
            );
          }

          // Evita rate limits de Hugging Face Inference API
          await sleep(250);
        } catch (error) {
          totalErrors++;
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[ingest]   ✗ ${label}: ${msg}`);
        }
      }

      totalSkipped += skippedForDoc;
      console.log(
        `[ingest] Resumen ${entry.ley}: ${insertedForDoc} procesados, ${skippedForDoc} omitidos`,
      );
    }

    console.log("\n[ingest] ===== FIN =====");
    console.log(`[ingest] Insertados/actualizados: ${totalInserted}`);
    console.log(`[ingest] Omitidos (ya existían): ${totalSkipped}`);
    console.log(`[ingest] Errores: ${totalErrors}`);
    if (opts.dryRun) {
      console.log("[ingest] Modo dry-run: no se escribió en la base de datos.");
    }
  } finally {
    if (pool) await pool.end();
    await terminateOcrWorker().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("[ingest] Falló:", error instanceof Error ? error.message : error);
  process.exit(1);
});
