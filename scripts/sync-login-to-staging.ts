/**
 * Copia datos de login (users / organizations / members) SOURCE → TARGET.
 * NO ejecuta migraciones ni DDL.
 *
 * Uso:
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... pnpm exec tsx scripts/sync-login-to-staging.ts
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... pnpm exec tsx scripts/sync-login-to-staging.ts --apply
 *
 * Sin --apply = dry-run (solo preflight + conteos).
 */
import { Pool, type PoolClient } from "pg";

const SOURCE_HOST_MARKER = "ep-super-art";
const TARGET_HOST_MARKER = "ep-curly-star";
const ORG_SLUGS = ["el-rancho-de-german", "monddy", "davean"] as const;
const TABLES = ["users", "organizations", "members"] as const;

const APPLY = process.argv.includes("--apply");

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(url invalida)";
  }
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta variable de entorno ${name}`);
  return v;
}

function sslFor(url: string) {
  return url.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined;
}

async function tableCount(client: PoolClient, table: string): Promise<number> {
  const r = await client.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return r.rows[0].n as number;
}

async function columnNames(
  client: PoolClient,
  table: string,
): Promise<string[]> {
  const r = await client.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  return r.rows.map((row) => row.column_name);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function resetSequence(
  client: PoolClient,
  table: string,
  idCol = "id",
): Promise<void> {
  await client.query(
    `SELECT setval(
       pg_get_serial_sequence($1, $2),
       COALESCE((SELECT MAX(${quoteIdent(idCol)}) FROM ${quoteIdent(table)}), 1),
       (SELECT MAX(${quoteIdent(idCol)}) IS NOT NULL FROM ${quoteIdent(table)})
     )`,
    [table, idCol],
  );
}

async function main(): Promise<void> {
  const sourceUrl = requireEnv("SOURCE_DATABASE_URL");
  const targetUrl = requireEnv("TARGET_DATABASE_URL");

  const sourceHost = hostOf(sourceUrl);
  const targetHost = hostOf(targetUrl);

  console.log("=== sync-login-to-staging ===");
  console.log(`Modo: ${APPLY ? "APPLY (escrituras en TARGET)" : "DRY-RUN"}`);
  console.log(`SOURCE host: ${sourceHost}`);
  console.log(`TARGET host: ${targetHost}`);
  console.log(`Slugs: ${ORG_SLUGS.join(", ")}`);

  if (!sourceHost.includes(SOURCE_HOST_MARKER)) {
    throw new Error(
      `ABORT: SOURCE host debe contener "${SOURCE_HOST_MARKER}". Got: ${sourceHost}`,
    );
  }
  if (!targetHost.includes(TARGET_HOST_MARKER)) {
    throw new Error(
      `ABORT: TARGET host debe contener "${TARGET_HOST_MARKER}". Got: ${targetHost}`,
    );
  }
  if (sourceHost === targetHost) {
    throw new Error("ABORT: SOURCE y TARGET no pueden ser el mismo host");
  }

  const source = new Pool({
    connectionString: sourceUrl,
    ssl: sslFor(sourceUrl),
    max: 2,
  });
  const target = new Pool({
    connectionString: targetUrl,
    ssl: sslFor(targetUrl),
    max: 2,
  });

  const sourceClient = await source.connect();
  const targetClient = await target.connect();

  try {
    await sourceClient.query("SET default_transaction_read_only = on");
    await sourceClient.query("SET statement_timeout = '60s'");
    await targetClient.query("SET statement_timeout = '60s'");

    // --- Preflight counts ---
    const sourceOrgs = await sourceClient.query<{
      id: number;
      slug: string;
      nombre: string;
    }>(
      `SELECT id, slug, nombre FROM organizations
       WHERE slug = ANY($1::text[])
       ORDER BY slug`,
      [ORG_SLUGS as unknown as string[]],
    );

    const sourceOrgCount = sourceOrgs.rowCount ?? sourceOrgs.rows.length;
    console.log("\n-- Preflight SOURCE --");
    console.log(`orgs matching slugs: ${sourceOrgCount}`);
    for (const o of sourceOrgs.rows) {
      console.log(`  id=${o.id} slug=${o.slug} nombre=${o.nombre}`);
    }

    if (sourceOrgCount !== 3) {
      throw new Error(
        `ABORT: SOURCE debe tener exactamente 3 orgs con esos slugs. Got: ${sourceOrgCount}`,
      );
    }

    const orgIds = sourceOrgs.rows.map((o) => o.id);

    const membersRes = await sourceClient.query<{
      id: number;
      user_id: number;
      organization_id: number;
    }>(
      `SELECT id, "userId" AS user_id, "organizationId" AS organization_id
       FROM members
       WHERE "organizationId" = ANY($1::int[])
       ORDER BY id`,
      [orgIds],
    );

    const userIds = [...new Set(membersRes.rows.map((m) => m.user_id))];
    const usersRes = await sourceClient.query<{
      id: number;
      email: string;
    }>(
      `SELECT id, email FROM users WHERE id = ANY($1::int[]) ORDER BY id`,
      [userIds],
    );

    console.log(`members for those orgs: ${membersRes.rows.length}`);
    console.log(`users via those members: ${usersRes.rows.length}`);
    console.log(
      `user emails: ${usersRes.rows.map((u) => u.email).join(", ")}`,
    );

    console.log("\n-- Preflight TARGET --");
    const targetCounts: Record<string, number> = {};
    for (const t of TABLES) {
      targetCounts[t] = await tableCount(targetClient, t);
      console.log(`${t}: ${targetCounts[t]}`);
    }

    if (
      targetCounts.organizations > 0 ||
      targetCounts.users > 0 ||
      targetCounts.members > 0
    ) {
      throw new Error(
        `ABORT: TARGET debe estar vacío (orgs/users/members = 0). Got orgs=${targetCounts.organizations} users=${targetCounts.users} members=${targetCounts.members}`,
      );
    }

    // --- Schema column intersection (no DDL) ---
    const colMap: Record<string, string[]> = {};
    for (const table of TABLES) {
      const srcCols = await columnNames(sourceClient, table);
      const tgtCols = await columnNames(targetClient, table);
      if (srcCols.length === 0) {
        throw new Error(`ABORT: tabla ${table} no existe en SOURCE`);
      }
      if (tgtCols.length === 0) {
        throw new Error(
          `ABORT: tabla ${table} no existe en TARGET (schema mismatch; no se migrará)`,
        );
      }
      const tgtSet = new Set(tgtCols);
      const missingOnTarget = srcCols.filter((c) => !tgtSet.has(c));
      const common = srcCols.filter((c) => tgtSet.has(c));
      if (!common.includes("id")) {
        throw new Error(`ABORT: columna id faltante en ${table}`);
      }
      if (missingOnTarget.length > 0) {
        console.warn(
          `WARN ${table}: columnas en SOURCE ausentes en TARGET (se omitirán): ${missingOnTarget.join(", ")}`,
        );
      }
      // Required business columns must exist on TARGET
      if (table === "users" && !tgtSet.has("email")) {
        throw new Error("ABORT: TARGET.users sin columna email");
      }
      if (table === "organizations" && !tgtSet.has("slug")) {
        throw new Error("ABORT: TARGET.organizations sin columna slug");
      }
      if (
        table === "members" &&
        (!tgtSet.has("userId") || !tgtSet.has("organizationId"))
      ) {
        throw new Error(
          "ABORT: TARGET.members sin userId/organizationId (schema mismatch)",
        );
      }
      colMap[table] = common;
      console.log(
        `columns ${table}: ${common.length} comunes (src=${srcCols.length} tgt=${tgtCols.length})`,
      );
    }

    if (!APPLY) {
      console.log(
        "\nDRY-RUN OK. Re-ejecuta con --apply para insertar en TARGET.",
      );
      return;
    }

    // --- Fetch full rows ---
    const usersFull = await sourceClient.query(
      `SELECT ${colMap.users.map(quoteIdent).join(", ")}
       FROM users WHERE id = ANY($1::int[])
       ORDER BY id`,
      [userIds],
    );
    const orgsFull = await sourceClient.query(
      `SELECT ${colMap.organizations.map(quoteIdent).join(", ")}
       FROM organizations WHERE id = ANY($1::int[])
       ORDER BY id`,
      [orgIds],
    );
    const membersFull = await sourceClient.query(
      `SELECT ${colMap.members.map(quoteIdent).join(", ")}
       FROM members WHERE "organizationId" = ANY($1::int[])
       ORDER BY id`,
      [orgIds],
    );

    console.log("\n-- APPLY: insertando users → organizations → members --");

    await targetClient.query("BEGIN");
    try {
      const insertRows = async (
        table: (typeof TABLES)[number],
        rows: Record<string, unknown>[],
      ) => {
        const cols = colMap[table];
        if (rows.length === 0) return;
        for (const row of rows) {
          const values = cols.map((c) => row[c]);
          const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
          try {
            await targetClient.query(
              `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(", ")})
               VALUES (${placeholders})`,
              values,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(
              `ABORT insert into ${table} id=${String(row.id)}: ${msg}. No se migrará el schema.`,
            );
          }
        }
        console.log(`inserted ${table}: ${rows.length}`);
      };

      await insertRows("users", usersFull.rows as Record<string, unknown>[]);
      await insertRows(
        "organizations",
        orgsFull.rows as Record<string, unknown>[],
      );
      await insertRows(
        "members",
        membersFull.rows as Record<string, unknown>[],
      );

      await resetSequence(targetClient, "users");
      await resetSequence(targetClient, "organizations");
      await resetSequence(targetClient, "members");
      console.log("sequences reset");

      await targetClient.query("COMMIT");
    } catch (e) {
      await targetClient.query("ROLLBACK");
      throw e;
    }

    console.log("\n-- TARGET after apply --");
    for (const t of TABLES) {
      console.log(`${t}: ${await tableCount(targetClient, t)}`);
    }
    const slugs = await targetClient.query<{ slug: string }>(
      `SELECT slug FROM organizations ORDER BY slug`,
    );
    const emails = await targetClient.query<{ email: string }>(
      `SELECT email FROM users ORDER BY email`,
    );
    console.log(`org slugs: ${slugs.rows.map((r) => r.slug).join(", ")}`);
    console.log(`user emails: ${emails.rows.map((r) => r.email).join(", ")}`);
    console.log("\nAPPLY OK");
  } finally {
    sourceClient.release();
    targetClient.release();
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error("\n" + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
