/**
 * Importa compras Monddy desde Excel formato COMPRAS (MES, FECHA, FACTURA, PROVEEDOR...).
 *
 * Uso:
 *   pnpm import:monddy-purchases --preview
 *   pnpm import:monddy-purchases --complete
 *   pnpm import:monddy-purchases --confirm [--file /ruta/archivo.xlsx]
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { assertMarfylDatabaseUrl } from "../src/common/database-guard";
import { PurchasesImportService } from "../src/modules/purchases-import/purchases-import.service";
import type { PrismaService } from "../src/common/prisma/prisma.service";

assertMarfylDatabaseUrl(process.env.DATABASE_URL);

const DEFAULT_FILE = "/home/gabdev/Descargas/COMPRAS 07072026.xlsx";
const MONDDY_ORG_ID = 2;

function parseArgs() {
  const args = process.argv.slice(2);
  const preview = args.includes("--preview");
  const confirm = args.includes("--confirm") || args.includes("--complete");
  const fileIdx = args.indexOf("--file");
  const file =
    fileIdx >= 0 ? args[fileIdx + 1] : DEFAULT_FILE;
  const orgIdx = args.indexOf("--org-id");
  const orgId = orgIdx >= 0 ? Number(args[orgIdx + 1]) : MONDDY_ORG_ID;
  return { preview, confirm, file, orgId };
}

async function resolveUserId(prisma: PrismaClient, orgId: number) {
  const member = await prisma.member.findFirst({
    where: { organizationId: orgId, status: "ACTIVE" },
    select: { userId: true },
    orderBy: { id: "asc" },
  });
  if (!member) throw new Error(`Sin miembros activos en org ${orgId}`);
  return member.userId;
}

async function main() {
  const opts = parseArgs();
  if (!opts.preview && !opts.confirm) {
    console.error(
      "Indique --preview o --complete\n" +
        "Ejemplo: pnpm import:monddy-purchases --complete",
    );
    process.exit(1);
  }

  const buffer = readFileSync(opts.file);
  const prisma = new PrismaClient();
  const service = new PurchasesImportService(prisma as unknown as PrismaService);

  try {
    const org = await prisma.organization.findFirst({
      where: { id: opts.orgId, deletedAt: null },
      select: { id: true, nombre: true, slug: true },
    });
    if (!org) throw new Error(`Organización ${opts.orgId} no encontrada`);

    console.log(`\n=== Import compras → ${org.nombre} (${org.slug}) ===`);
    console.log(`Archivo: ${opts.file}\n`);

    if (opts.preview) {
      const preview = await service.preview({
        buffer,
        fileName: opts.file,
        organizationId: opts.orgId,
      });
      console.log(JSON.stringify(preview, null, 2));
      return;
    }

    const userId = await resolveUserId(prisma, opts.orgId);
    const result = await service.confirm({
      buffer,
      fileName: opts.file,
      organizationId: opts.orgId,
      userId,
      skipImported: true,
    });
    console.log("\n✅ Importación completada:\n", JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
