import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantIsolationExtension } from './tenant-isolation.extension';
import { isDevPreviewAuthEnabled } from '../dev-preview';

// Siempre pasamos una URL no vacía a Prisma para evitar errores de validación
// cuando DATABASE_URL no está definida en tiempo de build. En producción/local real
// debes tener DATABASE_URL configurada correctamente.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://user:pass@localhost:5432/db';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  /** true si $connect falló en dev preview (API con datos no disponible). */
  dbAvailable = true;

  constructor() {
    super({ datasources: { db: { url: databaseUrl } } });
    // Extiende el mismo cliente inyectado para evitar mezclar instancias.
    // Mezclar clientes puede invalidar transacciones interactivas en ejecución.
    const extended = this.$extends(tenantIsolationExtension) as PrismaClient;
    Object.assign(this, extended);
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.dbAvailable = true;
    } catch (err) {
      if (isDevPreviewAuthEnabled()) {
        this.dbAvailable = false;
        this.logger.warn(
          'Postgres no disponible — inicie Docker (pnpm db:docker). UI y asistente Gemini pueden usarse; datos fiscales requieren BD.',
        );
        return;
      }
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
