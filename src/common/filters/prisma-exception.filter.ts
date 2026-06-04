import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

const DB_UNAVAILABLE =
  'PostgreSQL no está disponible o las credenciales de DATABASE_URL son incorrectas. ' +
  'En pgAdmin (usuario postgres), ejecute scripts/setup-local-postgres.sql y luego: ' +
  'pnpm prisma migrate deploy && pnpm seed. Reinicie el backend.';

function isDatabaseConnectivityError(exception: unknown): boolean {
  if (exception instanceof Prisma.PrismaClientInitializationError) return true;
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1000', 'P1001', 'P1002', 'P1003', 'P1017'].includes(exception.code);
  }
  if (exception instanceof Error) {
    const m = exception.message;
    return (
      m.includes("Can't reach database server") ||
      m.includes('ECONNREFUSED') ||
      m.includes('password authentication failed') ||
      m.includes('does not exist')
    );
  }
  return false;
}

@Catch(
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientKnownRequestError,
)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (!isDatabaseConnectivityError(exception)) {
      const status = HttpStatus.INTERNAL_SERVER_ERROR;
      response.status(status).json({
        statusCode: status,
        message: 'Internal server error',
      });
      return;
    }

    const payload = new ServiceUnavailableException(DB_UNAVAILABLE).getResponse();
    response.status(HttpStatus.SERVICE_UNAVAILABLE).json(payload);
  }
}
