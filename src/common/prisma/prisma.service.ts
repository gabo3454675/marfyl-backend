import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { tenantIsolationExtension } from "./tenant-isolation.extension";
import { isDevPreviewAuthEnabled } from "../dev-preview";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly databaseUrl: string;
  /** true si $connect falló en dev preview (API con datos no disponible). */
  dbAvailable = true;

  constructor(configService: ConfigService) {
    // T2-fix: leer DATABASE_URL desde ConfigService (que ya cargó .env vía
    // ConfigModule.forRoot) en lugar de process.env module-level. Antes,
    // la constante module-level se evaluaba ANTES de que ConfigModule corriera,
    // forzando el fallback 'postgresql://user:pass@localhost:5432/db' y
    // haciendo que la URL real de Neon nunca llegara al PrismaClient.
    const databaseUrl = configService.get<string>("DATABASE_URL");
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is not defined in environment");
    }
    super({ datasources: { db: { url: databaseUrl } } });
    this.databaseUrl = databaseUrl;
    // Extiende el mismo cliente inyectado para evitar mezclar instancias.
    // Mezclar clientes puede invalidar transacciones interactivas en ejecución.
    //
    // FIX: Usamos un Proxy en lugar de Object.assign porque Object.assign
    // copia el estado interno del cliente extendido (incluyendo la config
    // del datasource), corrompiendo la URL de conexión y causando
    // "InvalidDatasourceError: the URL must start with prisma://".
    // El Proxy delega el acceso a propiedades al cliente extendido sin
    // copiar su estado interno, preservando la configuración del super().
    const extended = this.$extends(tenantIsolationExtension);
    const self = this;
    // Conjunto de métodos de conexión que siempre deben ir al cliente base
    // de PrismaClient (super()), NO al extended client. El extended client
    // de Prisma 5.22.0 usa internamente la capa Accelerate que requiere
    // una URL con protocolo `prisma://`, lo que causa P6001 cuando la URL
    // es `postgresql://` (Neon, Supabase, etc.).
    const BASE_CLIENT_METHODS = new Set(["$connect", "$disconnect"]);
    return new Proxy(this, {
      get(_target, prop, _receiver) {
        // Métodos de conexión → cliente base (PrismaClient.prototype)
        if (typeof prop === "string" && BASE_CLIENT_METHODS.has(prop)) {
          const method = Reflect.get(PrismaClient.prototype, prop);
          return method ? method.bind(self) : undefined;
        }
        // Propiedades own de PrismaService (dbAvailable, logger, databaseUrl)
        if (Object.prototype.hasOwnProperty.call(self, prop)) {
          const value = Reflect.get(self, prop, self);
          return typeof value === "function" ? value.bind(self) : value;
        }
        // Todo lo demás (modelos, $transaction, $queryRaw, etc.)
        // → cliente extendido con tenant isolation
        return Reflect.get(extended, prop, extended);
      },
    });

    // Diagnóstico condicional solo en desarrollo, sin exponer datos sensibles
    if (process.env.NODE_ENV === "development") {
      console.log("databaseUrl (host/sslmode)", parseDbTarget(databaseUrl));
      console.log("process.env.DEBUG_DB", process.env.DEBUG_DB);
    }
  }

  async onModuleInit() {
    const debugDb = process.env.DEBUG_DB === "true";
    const { host, sslmode } = debugDb
      ? parseDbTarget(this.databaseUrl)
      : { host: "", sslmode: "" };
    const startedAt = Date.now();

    if (debugDb) {
      this.logger.log(
        `[PrismaService] onModuleInit: connecting... host=${host} sslmode=${sslmode}`,
      );
    }

    try {
      await this.$connect();
      this.dbAvailable = true;

      if (debugDb) {
        const latencyMs = Date.now() - startedAt;
        this.logger.log(
          `[PrismaService] onModuleInit: connected host=${host} sslmode=${sslmode} latencyMs=${latencyMs}`,
        );
      }
    } catch (err) {
      if (debugDb) {
        this.logger.error(
          `[PrismaService] onModuleInit: connect FAILED host=${host} sslmode=${sslmode}`,
        );
        this.logger.error(
          `[PrismaService] error name=${(err as { name?: string } | null)?.name ?? "unknown"} code=${(err as { code?: string } | null)?.code ?? "unknown"} message=${(err as { message?: string } | null)?.message ?? "unknown"}`,
        );
        this.logger.error(
          `[PrismaService] stack=${(err as { stack?: string } | null)?.stack ?? "unknown"}`,
        );
      }

      if (isDevPreviewAuthEnabled()) {
        this.dbAvailable = false;
        this.logger.warn(
          "Postgres no disponible — inicie Docker (pnpm db:docker). UI y asistente Gemini pueden usarse; datos fiscales requieren BD.",
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

/**
 * Extrae `host` y `sslmode` de una URL de Postgres para logging seguro.
 * - Nunca incluye el password.
 * - Si la URL es inválida o no es parseable, devuelve placeholders
 *   `<unparseable>` para que los logs de debug no rompan el arranque.
 */
function parseDbTarget(url: string): { host: string; sslmode: string } {
  try {
    const parsed = new URL(url);
    // `URL` parsea `postgresql://user:pass@host:port/db?...`. Para evitar
    // filtrar password si en el futuro alguien cambia el formato de log,
    // no copiamos `parsed.username` ni el `password` (que es el por defecto).
    return {
      host: parsed.host || "<unparseable>",
      sslmode: parsed.searchParams.get("sslmode") ?? "<unparseable>",
    };
  } catch {
    return { host: "<unparseable>", sslmode: "<unparseable>" };
  }
}
