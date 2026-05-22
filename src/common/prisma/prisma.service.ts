import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantIsolationExtension } from './tenant-isolation.extension';

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
  constructor() {
    super({ datasources: { db: { url: databaseUrl } } });
    // Extiende el mismo cliente inyectado para evitar mezclar instancias.
    // Mezclar clientes puede invalidar transacciones interactivas en ejecución.
    const extended = this.$extends(tenantIsolationExtension) as PrismaClient;
    Object.assign(this, extended);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
