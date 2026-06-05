import { Module } from "@nestjs/common";
import { DbPingController } from "./db-ping.controller";

/**
 * Módulo de endpoints de diagnóstico.
 * Por ahora solo expone `GET /api/public/db-ping`.
 *
 * `PrismaService` viene de `PrismaModule`, que es `@Global()` (ver
 * `src/common/prisma/prisma.module.ts`), por lo que no necesitamos
 * importarlo explícitamente aquí.
 */
@Module({
  controllers: [DbPingController],
})
export class HealthModule {}
