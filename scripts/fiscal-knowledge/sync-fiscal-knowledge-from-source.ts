#!/usr/bin/env tsx
/**
 * Copia marfyl_knowledge_embeddings desde Neon/producción → PostgreSQL LOCAL.
 * Solo lectura en origen. No modifica la BD de producción.
 *
 * Uso:
 *   1. Cree marfyl-backend/.env.fiscal-source con:
 *        FISCAL_KNOWLEDGE_SOURCE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
 *   2. pnpm sync:fiscal-knowledge
 *   3. pnpm sync:fiscal-knowledge -- --dry-run   (solo conteos)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";

interface CliOptions {
  dryRun: boolean;
  batchSize: number;
}

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

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, batchSize: 200 };
  for (const arg of argv) {
    if (arg === "--dry-run") opts.dryRun = true;
    if (arg.startsWith("--batch=")) {
      opts.batchSize = Math.max(50, Number(arg.slice("--batch=".length)) || 200);
    }
  }
  return opts;
}

function assertLocalDestination(url: string) {
  const n = url.toLowerCase();
  if (
    !n.includes("localhost") &&
    !n.includes("127.0.0.1") &&
    !n.includes("@host.docker.internal")
  ) {
    throw new Error(
      "[sync] DATABASE_URL destino debe ser PostgreSQL LOCAL (localhost). " +
        "No se escribirá en Neon/producción.",
    );
  }
}

function assertReadOnlySource(url: string) {
  const n = url.toLowerCase();
  if (n.includes("localhost") || n.includes("127.0.0.1")) {
    throw new Error(
      "[sync] FISCAL_KNOWLEDGE_SOURCE_URL no puede ser localhost — use Neon/producción.",
    );
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env"));
  loadEnvFile(path.join(cwd, ".env.fiscal-source"));

  const destUrl = process.env.DATABASE_URL?.trim();
  const sourceUrl =
    process.env.FISCAL_KNOWLEDGE_SOURCE_URL?.trim() ||
    process.env.MARFYL_SOURCE_DATABASE_URL?.trim();

  if (!destUrl) throw new Error("DATABASE_URL no configurada (destino local)");
  if (!sourceUrl) {
    throw new Error(
      "FISCAL_KNOWLEDGE_SOURCE_URL no configurada.\n" +
        "Cree marfyl-backend/.env.fiscal-source con la URL pooled de Neon (solo lectura).\n" +
        "Render → marfyl-backend → Environment → DATABASE_URL",
    );
  }

  assertLocalDestination(destUrl);
  assertReadOnlySource(sourceUrl);

  const source = new Pool({
    connectionString: sourceUrl,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const dest = new Pool({
    connectionString: destUrl,
    ssl: destUrl.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : undefined,
    max: 2,
  });

  try {
    const ext = await dest.query(
      "SELECT extname FROM pg_extension WHERE extname = 'vector'",
    );
    if (ext.rowCount === 0) {
      throw new Error(
        "Extensión pgvector no instalada en local. Ejecute CREATE EXTENSION vector como postgres.",
      );
    }

    const tableOk = await dest.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'marfyl_knowledge_embeddings'
      ) AS ok
    `);
    if (!tableOk.rows[0]?.ok) {
      throw new Error(
        "Tabla marfyl_knowledge_embeddings no existe en local. Aplique la migración fiscal pgvector.",
      );
    }

    await source.query("BEGIN READ ONLY");
    const countRes = await source.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM marfyl_knowledge_embeddings",
    );
    const total = Number(countRes.rows[0]?.count ?? 0);
    console.log(`[sync] Origen (solo lectura): ${total} embeddings`);

    const byLey = await source.query<{ ley: string; n: string }>(
      "SELECT ley, COUNT(*)::text AS n FROM marfyl_knowledge_embeddings GROUP BY ley ORDER BY ley",
    );
    for (const row of byLey.rows) {
      console.log(`[sync]   ${row.ley}: ${row.n}`);
    }

    if (total === 0) {
      console.log(
        "[sync] Origen vacío. En producción ejecute: pnpm ingest:fiscal-knowledge",
      );
      return;
    }

    if (opts.dryRun) {
      console.log("[sync] Modo dry-run — no se copió nada.");
      return;
    }

    const localCount = await dest.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM marfyl_knowledge_embeddings",
    );
    const localBefore = Number(localCount.rows[0]?.count ?? 0);
    if (localBefore > 0) {
      console.log(
        `[sync] Destino local ya tiene ${localBefore} registros — se hará upsert (no se borra nada).`,
      );
    }

    let offset = 0;
    let copied = 0;

    while (offset < total) {
      const batch = await source.query(
        `
        SELECT id, ley, articulo, chunk_index, titulo, content, metadata,
               embedding::text AS embedding_text, source_file, created_at, updated_at
        FROM marfyl_knowledge_embeddings
        ORDER BY ley, articulo, chunk_index
        LIMIT $1 OFFSET $2
        `,
        [opts.batchSize, offset],
      );

      for (const row of batch.rows) {
        await dest.query(
          `
          INSERT INTO marfyl_knowledge_embeddings (
            id, ley, articulo, chunk_index, titulo, content, metadata,
            embedding, source_file, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8::vector, $9, $10, $11
          )
          ON CONFLICT (ley, articulo, chunk_index)
          DO UPDATE SET
            titulo = EXCLUDED.titulo,
            content = EXCLUDED.content,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding,
            source_file = EXCLUDED.source_file,
            updated_at = EXCLUDED.updated_at
          `,
          [
            row.id,
            row.ley,
            row.articulo,
            row.chunk_index,
            row.titulo,
            row.content,
            JSON.stringify(row.metadata ?? {}),
            row.embedding_text,
            row.source_file,
            row.created_at,
            row.updated_at,
          ],
        );
        copied++;
      }

      offset += batch.rowCount;
      console.log(`[sync] Progreso: ${offset}/${total}`);
    }

    const finalCount = await dest.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM marfyl_knowledge_embeddings",
    );
    console.log(
      `[sync] Listo. Local: ${finalCount.rows[0]?.count} embeddings (${copied} procesados).`,
    );
  } finally {
    await source.query("ROLLBACK").catch(() => undefined);
    await source.end();
    await dest.end();
  }
}

main().catch((error) => {
  console.error(
    "[sync] Falló:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
