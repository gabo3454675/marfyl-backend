import { ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

export const DB_SETUP_HINT =
  "PostgreSQL no disponible. Ejecute scripts/setup-local-postgres.sql en pgAdmin, luego pnpm prisma migrate deploy && pnpm seed.";

export function assertDbAvailable(prisma: PrismaService): void {
  if (!prisma.dbAvailable) {
    throw new ServiceUnavailableException(DB_SETUP_HINT);
  }
}
