/**
 * Verificación solo-lectura del historial Monddy (issueDate / COALESCE).
 * No escribe en DB. Exit 0 si checks OK; 1 si falla paridad Excel FAC.
 *
 * Uso:
 *   pnpm exec tsx scripts/verify-history-issue-date.ts
 *   pnpm exec tsx scripts/verify-history-issue-date.ts --org=2
 */
import { PrismaClient } from "@prisma/client";

const ORG = Number(
  process.argv.find((a) => a.startsWith("--org="))?.slice(6) ?? "2",
);
const HASH =
  "b823b2f967c5138876926457cd923c9d536f39cba27df8aa0befce054f10ef40";
const TARGET_FAC = 1098;
const TARGET_ACTIVE_LINES = 2171;
const TARGET_NET = 10399.18;

async function main() {
  const prisma = new PrismaClient();
  let failed = false;

  try {
    console.log(`\n=== verify-history-issue-date org=${ORG} (read-only) ===\n`);

    // V2: max effective date vs max issueDate
    const bounds = await prisma.$queryRaw<
      Array<{
        max_issue: string | null;
        max_effective: string | null;
        null_issue_active: number;
      }>
    >`
      SELECT
        MAX(("issueDate" AT TIME ZONE 'UTC')::date)::text AS max_issue,
        MAX((COALESCE("issueDate", "createdAt") AT TIME ZONE 'UTC')::date)::text AS max_effective,
        COUNT(*) FILTER (WHERE "issueDate" IS NULL AND "deletedAt" IS NULL)::int AS null_issue_active
      FROM invoices
      WHERE "organizationId" = ${ORG}
        AND "deletedAt" IS NULL
        AND COALESCE("issueDate", "createdAt") >= '2026-06-29'::timestamptz
        AND COALESCE("issueDate", "createdAt") < '2026-07-30'::timestamptz
    `;
    console.log("V2 bounds", bounds[0]);

    // V3: FAC vs CUADRE by day (sample peak days)
    const mix = await prisma.$queryRaw<
      Array<{
        day: string;
        n: number;
        fac: number;
        cuadre: number;
        total: number;
      }>
    >`
      SELECT
        (("issueDate" AT TIME ZONE 'UTC')::date)::text AS day,
        COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE "legacyImportKey" LIKE 'FAC-%')::int AS fac,
        COUNT(*) FILTER (WHERE "legacyImportKey" LIKE 'CUADRE-%')::int AS cuadre,
        ROUND(SUM("totalAmount")::numeric, 2)::float AS total
      FROM invoices
      WHERE "organizationId" = ${ORG}
        AND "deletedAt" IS NULL
        AND "issueDate" >= '2026-07-01'
        AND "issueDate" < '2026-07-30'
      GROUP BY 1
      ORDER BY 1
    `;
    const peak = mix.reduce(
      (a, d) => (d.total > a.total ? d : a),
      mix[0] ?? { day: "?", n: 0, fac: 0, cuadre: 0, total: 0 },
    );
    console.log("V3 days", mix.length, "peak", peak);

    // V4: Excel FAC parity 1–22 jul
    const facNet = await prisma.$queryRaw<Array<{ fac: number; net: number }>>`
      SELECT
        COUNT(*)::int AS fac,
        ROUND(SUM("totalAmount")::numeric, 2)::float AS net
      FROM invoices
      WHERE "organizationId" = ${ORG}
        AND "deletedAt" IS NULL
        AND "legacyImportKey" LIKE 'FAC-%'
        AND "issueDate" >= '2026-07-01'
        AND "issueDate" < '2026-07-23'
    `;

    const lines = await prisma.$queryRaw<Array<{ active_lines: number }>>`
      SELECT COUNT(*)::int AS active_lines
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii."invoiceId"
      WHERE i."organizationId" = ${ORG}
        AND i."deletedAt" IS NULL
        AND i."legacyImportKey" LIKE 'FAC-%'
        AND i."issueDate" >= '2026-07-01'
        AND i."issueDate" < '2026-07-23'
        AND ii."lineageStatus" = 'ACTIVE'
    `;

    const facCount = facNet[0]?.fac ?? 0;
    const net = facNet[0]?.net ?? 0;
    const activeLines = lines[0]?.active_lines ?? 0;

    console.log("V4 FAC 1–22 jul", {
      fac: facCount,
      active_lines: activeLines,
      net,
      target: {
        fac: TARGET_FAC,
        active_lines: TARGET_ACTIVE_LINES,
        net: TARGET_NET,
        sourceHash: HASH,
      },
    });

    const netOk = Math.abs(net - TARGET_NET) < 0.02;
    if (
      facCount !== TARGET_FAC ||
      activeLines !== TARGET_ACTIVE_LINES ||
      !netOk
    ) {
      console.error("V4 FAIL: paridad Excel FAC no cuadra");
      failed = true;
    } else {
      console.log("V4 PASS: paridad Excel FAC");
    }

    // COALESCE vs issueDate-only count (should match when 0 nulls)
    const coalesceCount = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM invoices
      WHERE "organizationId" = ${ORG}
        AND "deletedAt" IS NULL
        AND COALESCE("issueDate", "createdAt") >= '2026-06-29'::timestamptz
        AND COALESCE("issueDate", "createdAt") <= '2026-07-29T23:59:59.999Z'::timestamptz
    `;
    const issueOnlyCount = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
      FROM invoices
      WHERE "organizationId" = ${ORG}
        AND "deletedAt" IS NULL
        AND "issueDate" >= '2026-06-29'::timestamptz
        AND "issueDate" <= '2026-07-29T23:59:59.999Z'::timestamptz
    `;
    console.log("V1-ish counts", {
      coalesce: coalesceCount[0]?.n,
      issueOnly: issueOnlyCount[0]?.n,
      nullIssueInOrg: bounds[0]?.null_issue_active,
    });

    console.log(
      "\nV5 (UI): Emisión=issueDate, Registro=createdAt — verificar manual en /history\n",
    );

    if (failed) process.exitCode = 1;
    else console.log("=== DONE OK ===\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
