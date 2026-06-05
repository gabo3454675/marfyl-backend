import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { SkipThrottle } from "@nestjs/throttler";
import { PrismaService } from "@/common/prisma/prisma.service";
import { Public } from "@/common/decorators/public.decorator";

/**
 * Endpoint de diagnóstico de conectividad a base de datos.
 *
 * Ruta efectiva: GET /api/public/db-ping
 *   - prefijo global `api` (main.ts)
 *   - controller path `public`
 *   - handler path `db-ping`
 *
 * - `@Public()`: salta JwtAuthGuard (metadata IS_PUBLIC_KEY).
 * - `@SkipThrottle()`: salta el ThrottlerGuard global registrado en app.module.
 * - No requiere organización, rol ni throttling.
 *
 * Devuelve 200 si `SELECT 1` responde, 503 si Prisma lanza un error de
 * conectividad/autenticación. El shape es estable para que herramientas
 * externas (curl, monitor, dashboard) puedan parsearlo.
 */
@SkipThrottle()
@Controller("public")
export class DbPingController {
  private readonly logger = new Logger(DbPingController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("db-ping")
  @HttpCode(HttpStatus.OK)
  async ping(): Promise<
    | {
        ok: true;
        db: "reachable";
        latencyMs: number;
        timestamp: string;
      }
    | {
        ok: false;
        db: "unreachable";
        error: string;
        code: string;
        latencyMs: number;
        timestamp: string;
      }
  > {
    const startedAt = Date.now();
    const timestamp = new Date().toISOString();

    try {
      await this.prisma.$queryRaw`SELECT 1 AS ok`;
      const latencyMs = Date.now() - startedAt;

      if (process.env.DEBUG_DB === "true") {
        this.logger.log(
          `[db-ping] timestamp=${timestamp} ok=true latencyMs=${latencyMs}`,
        );
      }

      return {
        ok: true,
        db: "reachable",
        latencyMs,
        timestamp,
      };
    } catch (err) {
      const latencyMs = Date.now() - startedAt;
      const { error, code } = mapPrismaError(err);

      if (process.env.DEBUG_DB === "true") {
        this.logger.log(
          `[db-ping] timestamp=${timestamp} ok=false latencyMs=${latencyMs} error="${error}" code="${code}"`,
        );
      }

      // Lanzamos ServiceUnavailableException con un body 503 estable.
      // Adjuntamos campos extra en `details` para que el cliente vea
      // error/code/latencyMs/timestamp sin perder el contrato estándar
      // de NestJS para errores HTTP.
      throw new ServiceUnavailableException({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: "Database unreachable",
        details: {
          ok: false,
          db: "unreachable",
          error,
          code,
          latencyMs,
          timestamp,
        },
      });
    }
  }
}

/**
 * Mapea un error desconocido al par (mensaje, código) que verá el cliente.
 * - PrismaClientKnownRequestError → code = err.code (P1000/P1001/P1002/P1003/P1017).
 * - PrismaClientInitializationError → code = 'INIT_ERROR'.
 * - Error genérico → code = 'UNKNOWN'.
 * Nunca expone stack ni metadata sensible.
 */
function mapPrismaError(err: unknown): { error: string; code: string } {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      error: err.message,
      code: err.code,
    };
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      error: err.message,
      code: "INIT_ERROR",
    };
  }
  if (err instanceof Error) {
    return {
      error: err.message,
      code: "UNKNOWN",
    };
  }
  return {
    error: String(err),
    code: "UNKNOWN",
  };
}
