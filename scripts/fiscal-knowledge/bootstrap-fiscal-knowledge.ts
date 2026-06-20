#!/usr/bin/env tsx
/**
 * Bootstrap mínimo del RAG fiscal en local (sin PDFs ni Neon).
 * Inserta fragmentos legales clave con embeddings Hugging Face.
 * Para copia completa desde producción use: pnpm sync:fiscal-knowledge
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { assertMarfylDatabaseUrl } from "../../src/common/database-guard";
import {
  generarEmbeddingGratuito,
  resolveHuggingFaceApiKey,
} from "../../src/modules/fiscal-knowledge/generar-embedding-gratuito";
import type { FiscalArticleChunk } from "../../src/modules/fiscal-knowledge/article-chunker";
import {
  articleExists,
  createPgPool,
  insertArticleEmbedding,
  knowledgeTableExists,
} from "./db";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

/** Fragmentos legales resumidos para desarrollo local (no sustituyen ingesta completa). */
function bootstrapChunk(
  ley: string,
  articulo: number,
  titulo: string,
  content: string,
  topic: string,
): FiscalArticleChunk {
  return {
    ley,
    articulo,
    chunkIndex: 0,
    titulo,
    content,
    metadata: {
      ley,
      articulo,
      chunkIndex: 0,
      titulo,
      title: titulo,
      sourceFile: "bootstrap-local",
      topic,
    } as FiscalArticleChunk["metadata"] & { topic: string },
  };
}

const BOOTSTRAP_CHUNKS: FiscalArticleChunk[] = [
  bootstrapChunk(
    "COT",
    117,
    "Sanciones por incumplimiento de obligaciones formales",
    "Código Orgánico Tributario — Obligaciones formales: el contribuyente debe presentar declaraciones y registros en los plazos legales. El incumplimiento genera sanciones por declaración extemporánea, calculadas sobre la base imponible o en UT según el tipo de obligación. Contribuyente Especial: plazos y obligaciones adicionales de retención y comprobantes.",
    "sanciones_formales",
  ),
  bootstrapChunk(
    "COT",
    118,
    "Multa por declaración extemporánea",
    "COT — Declaración extemporánea sin pago: multa equivalente a un porcentaje de la base imponible o monto fijo en UT, según corresponda. Si hay pago extemporáneo de impuesto, pueden aplicarse intereses moratorios además de la multa formal.",
    "declaracion_tarde",
  ),
  bootstrapChunk(
    "LIVA",
    27,
    "Alícuota general del IVA",
    "Ley del IVA — Alícuota general: 16% sobre la base imponible. Existen alícuotas reducidas y exenciones previstas en la ley y su reglamento para bienes y servicios específicos.",
    "alicuota_iva",
  ),
  bootstrapChunk(
    "RIVA",
    19,
    "Plazo declaración IVA mensual",
    "Reglamento IVA — Declaración mensual del IVA: dentro de los quince (15) días siguientes al mes vencido, salvo calendario especial del SENIAT. Contribuyente Especial: obligaciones de retención y emisión de comprobantes fiscales.",
    "plazo_iva",
  ),
  bootstrapChunk(
    "PROV_0071",
    1,
    "Providencia SNAT/0071 — Facturación",
    "Providencia Administrativa SNAT/0071 — Emisión de facturas fiscales, notas de débito y crédito, requisitos de comprobantes, máquinas fiscales y medios electrónicos autorizados por el SENIAT.",
    "facturacion",
  ),
  bootstrapChunk(
    "CALENDARIO_2026",
    1,
    "Calendario fiscal — obligaciones periódicas",
    "Calendario fiscal SENIAT — Fechas límite para declaración y pago de IVA, retenciones ISLR/IVA, contribuyentes especiales y ordinarios según terminación de RIF.",
    "calendario",
  ),
];

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env"));

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL no configurada");
  assertMarfylDatabaseUrl(databaseUrl);

  const n = databaseUrl.toLowerCase();
  if (!n.includes("localhost") && !n.includes("127.0.0.1")) {
    throw new Error(
      "bootstrap-fiscal-knowledge solo puede ejecutarse contra BD LOCAL.",
    );
  }

  if (!resolveHuggingFaceApiKey()) {
    throw new Error("HUGGINGFACE_API_KEY requerida para embeddings");
  }

  const pool = createPgPool(databaseUrl);
  try {
    if (!(await knowledgeTableExists(pool))) {
      throw new Error(
        "Tabla marfyl_knowledge_embeddings no existe. Instale pgvector y aplique migración.",
      );
    }

    let inserted = 0;
    let skipped = 0;

    for (const chunk of BOOTSTRAP_CHUNKS) {
      const exists = await articleExists(
        pool,
        chunk.ley,
        chunk.articulo,
        chunk.chunkIndex,
      );
      if (exists) {
        skipped++;
        continue;
      }

      const embedding = await generarEmbeddingGratuito(chunk.content);
      await insertArticleEmbedding(
        pool,
        chunk,
        embedding,
        "bootstrap-local",
      );
      inserted++;
      console.log(`[bootstrap] ✓ ${chunk.ley} art.${chunk.articulo}`);
    }

    console.log(
      `[bootstrap] Fin: ${inserted} insertados, ${skipped} ya existían.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    "[bootstrap] Falló:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
