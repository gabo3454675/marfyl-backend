/**
 * Selective login-data sync: SOURCE (prod) → TARGET (staging).
 * Copies ONLY: users (closed set), organizations (3 slugs), members.
 *
 * Default: dry-run. Pass --apply to write to TARGET.
 *
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... \
 *     pnpm exec tsx scripts/sync-login-data-prod-to-staging.ts
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... \
 *     pnpm exec tsx scripts/sync-login-data-prod-to-staging.ts --apply
 *
 * Hard rules:
 * - ZERO writes to SOURCE (read-only session)
 * - SOURCE host must contain ep-super-art
 * - TARGET host must contain ep-curly-star
 * - Abort if TARGET already has organizations/users/members > 0
 * - No products, invoices, companies, tokens, etc.
 */
import { Client } from "pg";

const APPLY = process.argv.includes("--apply");
const SOURCE_MARKER = "ep-super-art";
const TARGET_MARKER = "ep-curly-star";
const ORG_SLUGS = ["el-rancho-de-german", "monddy", "davean"] as const;

const SOURCE_URL =
  process.env.SOURCE_DATABASE_URL ??
  process.env.SOURCE_URL ??
  "";
const TARGET_URL =
  process.env.TARGET_DATABASE_URL ??
  process.env.TARGET_URL ??
  "";

type OrgRow = Record<string, unknown> & { id: number; slug: string };
type UserRow = Record<string, unknown> & { id: number; email: string };
type MemberRow = Record<string, unknown> & {
  id: number;
  userId: number;
  organizationId: number;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(url invalida)";
  }
}

function requireUrl(name: string, url: string): void {
  if (!url.trim()) {
    throw new Error(`Falta ${name}`);
  }
}

async function tableCount(client: Client, table: string): Promise<number> {
  const res = await client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM "${table}"`,
  );
  return res.rows[0]?.c ?? 0;
}

async function resetSequence(
  client: Client,
  table: string,
  column = "id",
): Promise<void> {
  await client.query(
    `SELECT setval(
      pg_get_serial_sequence($1, $2),
      COALESCE((SELECT MAX("${column}") FROM "${table}"), 1),
      true
    )`,
    [table, column],
  );
}

function insertSql(
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
): { text: string; values: unknown[] } {
  if (rows.length === 0) {
    throw new Error(`No hay filas para insertar en ${table}`);
  }
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIdx) => {
    const placeholders = columns.map((col, colIdx) => {
      values.push(row[col] ?? null);
      return `$${rowIdx * columns.length + colIdx + 1}`;
    });
    return `(${placeholders.join(", ")})`;
  });
  const quotedCols = columns.map((c) => `"${c}"`).join(", ");
  return {
    text: `INSERT INTO "${table}" (${quotedCols}) VALUES ${tuples.join(", ")}`,
    values,
  };
}

async function main(): Promise<void> {
  requireUrl("SOURCE_DATABASE_URL", SOURCE_URL);
  requireUrl("TARGET_DATABASE_URL", TARGET_URL);

  const sourceHost = hostOf(SOURCE_URL);
  const targetHost = hostOf(TARGET_URL);

  console.log(`SOURCE_HOST=${sourceHost}`);
  console.log(`TARGET_HOST=${targetHost}`);
  console.log(`MODE=${APPLY ? "APPLY" : "DRY_RUN"}`);

  if (!sourceHost.includes(SOURCE_MARKER)) {
    throw new Error(
      `ABORT: SOURCE host no contiene ${SOURCE_MARKER} (got ${sourceHost})`,
    );
  }
  if (!targetHost.includes(TARGET_MARKER)) {
    throw new Error(
      `ABORT: TARGET host no contiene ${TARGET_MARKER} (got ${targetHost})`,
    );
  }

  const source = new Client({
    connectionString: SOURCE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const target = new Client({
    connectionString: TARGET_URL,
    ssl: { rejectUnauthorized: false },
  });

  await source.connect();
  await source.query("SET default_transaction_read_only = on");
  await target.connect();

  try {
    // Schema presence check on TARGET (abort if missing; never migrate)
    for (const table of ["users", "organizations", "members"] as const) {
      const cols = await target.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      if (cols.rows.length === 0) {
        throw new Error(
          `ABORT: TARGET falta tabla "${table}". No se migrará schema.`,
        );
      }
    }

    const beforeSource = {
      organizations: await tableCount(source, "organizations"),
      users: await tableCount(source, "users"),
      members: await tableCount(source, "members"),
      products: await tableCount(source, "products"),
    };
    const beforeTarget = {
      organizations: await tableCount(target, "organizations"),
      users: await tableCount(target, "users"),
      members: await tableCount(target, "members"),
      products: await tableCount(target, "products"),
    };

    console.log("BEFORE_SOURCE", JSON.stringify(beforeSource));
    console.log("BEFORE_TARGET", JSON.stringify(beforeTarget));

    if (beforeSource.organizations < 3 || beforeSource.users < 1 || beforeSource.members < 1) {
      throw new Error("ABORT: SOURCE no tiene datos esperados de login");
    }
    for (const key of ["organizations", "users", "members"] as const) {
      if (beforeTarget[key] > 0) {
        throw new Error(
          `ABORT: TARGET no vacío (${key}=${beforeTarget[key]})`,
        );
      }
    }

    const orgRes = await source.query<OrgRow>(
      `SELECT * FROM organizations
       WHERE slug = ANY($1::text[])
       ORDER BY id`,
      [ORG_SLUGS as unknown as string[]],
    );
    const orgs = orgRes.rows;
    const foundSlugs = orgs.map((o) => o.slug).sort();
    const expected = [...ORG_SLUGS].sort();
    if (
      orgs.length !== expected.length ||
      foundSlugs.join(",") !== expected.join(",")
    ) {
      throw new Error(
        `ABORT: orgs filtradas inesperadas. expected=${expected.join(",")} got=${foundSlugs.join(",")}`,
      );
    }
    const orgIds = orgs.map((o) => o.id);

    const memberRes = await source.query<MemberRow>(
      `SELECT * FROM members
       WHERE "organizationId" = ANY($1::int[])
       ORDER BY id`,
      [orgIds],
    );
    const members = memberRes.rows;
    const userIds = [...new Set(members.map((m) => m.userId))].sort(
      (a, b) => a - b,
    );

    const userRes = await source.query<UserRow>(
      `SELECT * FROM users
       WHERE id = ANY($1::int[])
       ORDER BY id`,
      [userIds],
    );
    const users = userRes.rows;

    if (users.length !== userIds.length) {
      throw new Error(
        `ABORT: users cerrados incompletos. expected=${userIds.length} got=${users.length}`,
      );
    }

    console.log("PLAN", {
      organizations: orgs.length,
      slugs: foundSlugs,
      members: members.length,
      users: users.length,
      emails: users.map((u) => u.email),
    });

    if (!APPLY) {
      console.log("DRY_RUN_OK — sin escrituras. Pasa --apply para ejecutar.");
      return;
    }

    const userCols = [
      "id",
      "email",
      "passwordHash",
      "fullName",
      "avatarUrl",
      "isSuperAdmin",
      "isActive",
      "requiresPasswordChange",
      "createdAt",
      "updatedAt",
    ];
    const orgCols = [
      "id",
      "nombre",
      "slug",
      "plan",
      "billingExempt",
      "concertModuleEnabled",
      "deletedAt",
      "currencyCode",
      "currencySymbol",
      "exchangeRate",
      "rateUpdatedAt",
      "euroExchangeRate",
      "euroRateUpdatedAt",
      "taxId",
      "legalName",
      "isSpecialTaxpayer",
      "isFormalTaxpayer",
      "createdAt",
      "updatedAt",
    ];
    const memberCols = [
      "id",
      "userId",
      "organizationId",
      "role",
      "status",
      "joinedAt",
    ];

    await target.query("BEGIN");
    try {
      const u = insertSql("users", userCols, users);
      await target.query(u.text, u.values);

      const o = insertSql("organizations", orgCols, orgs);
      await target.query(o.text, o.values);

      const m = insertSql("members", memberCols, members);
      await target.query(m.text, m.values);

      await resetSequence(target, "users");
      await resetSequence(target, "organizations");
      await resetSequence(target, "members");

      await target.query("COMMIT");
    } catch (err) {
      await target.query("ROLLBACK");
      throw err;
    }

    const afterTarget = {
      organizations: await tableCount(target, "organizations"),
      users: await tableCount(target, "users"),
      members: await tableCount(target, "members"),
      products: await tableCount(target, "products"),
    };
    const afterSource = {
      organizations: await tableCount(source, "organizations"),
      users: await tableCount(source, "users"),
      members: await tableCount(source, "members"),
      products: await tableCount(source, "products"),
    };
    const targetSlugs = (
      await target.query<{ slug: string }>(
        `SELECT slug FROM organizations ORDER BY slug`,
      )
    ).rows.map((r) => r.slug);
    const targetEmails = (
      await target.query<{ email: string }>(
        `SELECT email FROM users ORDER BY email`,
      )
    ).rows.map((r) => r.email);

    console.log("AFTER_SOURCE", JSON.stringify(afterSource));
    console.log("AFTER_TARGET", JSON.stringify(afterTarget));
    console.log("TARGET_SLUGS", targetSlugs.join(","));
    console.log("TARGET_EMAILS", targetEmails.join(","));

    if (afterTarget.organizations !== 3) {
      throw new Error("POSTCHECK FAIL: organizations != 3");
    }
    if (afterTarget.users !== userIds.length) {
      throw new Error(
        `POSTCHECK FAIL: users=${afterTarget.users} expected=${userIds.length}`,
      );
    }
    if (afterTarget.members !== members.length) {
      throw new Error(
        `POSTCHECK FAIL: members=${afterTarget.members} expected=${members.length}`,
      );
    }
    if (afterTarget.products !== 0) {
      throw new Error("POSTCHECK FAIL: products != 0");
    }
    if (
      afterSource.organizations !== beforeSource.organizations ||
      afterSource.users !== beforeSource.users ||
      afterSource.members !== beforeSource.members ||
      afterSource.products !== beforeSource.products
    ) {
      throw new Error("POSTCHECK FAIL: SOURCE counts changed (unexpected write?)");
    }

    console.log("APPLY_OK");
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
