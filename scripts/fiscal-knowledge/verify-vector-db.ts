import * as fs from "node:fs";
import * as path from "node:path";
import pg from "pg";
import { generarEmbeddingGratuito } from "../../src/modules/fiscal-knowledge/generar-embedding-gratuito";
import { vectorToPgLiteral } from "../../src/modules/fiscal-knowledge/generar-embedding-gratuito";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

async function main() {
  loadEnvFile(path.join(process.cwd(), ".env"));

  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL no configurada");

  const client = new pg.Client({ connectionString: url });
  await client.connect();

  const ext = await client.query(
    "SELECT extname FROM pg_extension WHERE extname = 'vector'",
  );
  console.log("[verify] extensión vector:", ext.rows[0] ? "OK" : "FALTA");

  const table = await client.query(
    `SELECT column_name, udt_name
     FROM information_schema.columns
     WHERE table_name = 'marfyl_knowledge_embeddings' AND column_name = 'embedding'`,
  );
  console.log("[verify] columna embedding:", table.rows[0] ?? "FALTA");

  const counts = await client.query(
    `SELECT ley, COUNT(*)::int AS n
     FROM marfyl_knowledge_embeddings
     GROUP BY ley ORDER BY ley`,
  );
  console.log("[verify] registros por ley:");
  for (const row of counts.rows) {
    console.log(`  ${row.ley}: ${row.n}`);
  }
  const total = counts.rows.reduce((s: number, r: { n: number }) => s + r.n, 0);
  console.log(`[verify] total: ${total}`);

  if (total > 0) {
    const q = "¿Cuál es la alícuota general del IVA en Venezuela?";
    const vec = await generarEmbeddingGratuito(q);
    const literal = vectorToPgLiteral(vec);
    const hits = await client.query(
      `SELECT ley, articulo, titulo,
              1 - (embedding <=> $1::vector) AS similarity,
              LEFT(content, 120) AS excerpt
       FROM marfyl_knowledge_embeddings
       ORDER BY embedding <=> $1::vector
       LIMIT 3`,
      [literal],
    );
    console.log("[verify] búsqueda semántica (top 3):");
    for (const h of hits.rows) {
      console.log(
        `  ${h.ley} art.${h.articulo} sim=${Number(h.similarity).toFixed(3)} — ${h.excerpt?.replace(/\s+/g, " ")}…`,
      );
    }
  }

  await client.end();
  console.log("[verify] OK — BD vectorial operativa");
}

main().catch((e) => {
  console.error("[verify] FALLO:", e instanceof Error ? e.message : e);
  process.exit(1);
});
