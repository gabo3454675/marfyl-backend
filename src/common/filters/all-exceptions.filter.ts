import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";

const SENSITIVE_BODY_KEYS = new Set([
  "password",
  "newPassword",
  "oldPassword",
  "currentPassword",
  "confirmPassword",
  "token",
  "refreshToken",
  "accessToken",
  "secret",
]);

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "x-csrf-token",
]);

/**
 * Global diagnostic exception filter.
 *
 * Captures EVERY unhandled exception (not only Prisma errors) and logs the
 * full stack trace plus request context, so we can diagnose 500s on
 * /api/dashboard, /api/tasks, /api/fiscal and any other endpoint.
 *
 * Behavior:
 *  - HttpException → respects its getStatus() and getResponse(). The original
 *    response body is preserved (so 4xx contracts do not change); extra
 *    diagnostic fields (timestamp, path, method, errorName, stack) are added
 *    on top.
 *  - Non-HttpException → 500 with the full diagnostic shape.
 *  - 4xx → logged as `warn`. 5xx → logged as `error`.
 *  - Stack traces are only included in the response body when
 *    NODE_ENV !== "production".
 *
 * NOTE: This filter exists temporarily to debug 500s. It is NOT a
 * production-grade error handler. Decide before promoting to production
 * whether to:
 *   - keep it (with stack stripped in prod responses, and ideally a
 *     structured logger / Sentry integration on top),
 *   - replace it with a more sophisticated filter, or
 *   - remove it and rely on the default Nest error response.
 *
 * @diagnostic
 * @temporary
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestPath = request.originalUrl || request.url || "";
    const requestMethod = request.method || "UNKNOWN";
    const errorName =
      exception instanceof Error ? exception.name : typeof exception;

    const requestContext = {
      method: requestMethod,
      url: requestPath,
      body: this.sanitizeBody(request.body),
      headers: this.sanitizeHeaders(
        request.headers as Record<string, unknown> | undefined,
      ),
    };

    const errorMessage = this.extractErrorMessage(exception);
    const errorStack = exception instanceof Error ? exception.stack : undefined;

    const header = `[${requestMethod} ${requestPath}] ${errorName}: ${errorMessage}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(header, errorStack);
      this.logger.error(`Request context: ${JSON.stringify(requestContext)}`);
    } else {
      this.logger.warn(`${header} | context=${JSON.stringify(requestContext)}`);
    }

    const responseBody: Record<string, unknown> = isHttpException
      ? this.buildHttpExceptionBody(
          exception,
          requestPath,
          requestMethod,
          errorStack,
        )
      : this.buildGenericBody(
          status,
          errorName,
          errorMessage,
          requestPath,
          requestMethod,
          errorStack,
        );

    response.status(status).json(responseBody);
  }

  private buildHttpExceptionBody(
    exception: HttpException,
    path: string,
    method: string,
    stack: string | undefined,
  ): Record<string, unknown> {
    const original = exception.getResponse();
    const base: Record<string, unknown> =
      original && typeof original === "object"
        ? { ...(original as Record<string, unknown>) }
        : { message: original };

    base.timestamp = new Date().toISOString();
    base.path = path;
    base.method = method;
    base.errorName = exception.name;

    if (process.env.NODE_ENV !== "production" && stack) {
      base.stack = stack;
    }

    return base;
  }

  private buildGenericBody(
    status: number,
    errorName: string,
    errorMessage: string,
    path: string,
    method: string,
    stack: string | undefined,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
      method,
      errorName,
      errorMessage,
    };

    if (process.env.NODE_ENV !== "production" && stack) {
      body.stack = stack;
    }

    return body;
  }

  private extractErrorMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (res && typeof res === "object") {
        const m = (res as { message?: unknown }).message;
        if (Array.isArray(m)) return m.join("; ");
        if (typeof m === "string") return m;
      }
      if (typeof res === "string") return res;
      return exception.message;
    }
    if (exception instanceof Error) return exception.message;
    if (typeof exception === "string") return exception;
    try {
      return JSON.stringify(exception);
    } catch {
      return String(exception);
    }
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body || typeof body !== "object") return body;
    const cloned: Record<string, unknown> = {
      ...(body as Record<string, unknown>),
    };
    for (const key of Object.keys(cloned)) {
      if (SENSITIVE_BODY_KEYS.has(key)) {
        cloned[key] = "[REDACTED]";
      }
    }
    return cloned;
  }

  private sanitizeHeaders(
    headers: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!headers || typeof headers !== "object") return {};
    const cloned: Record<string, unknown> = { ...headers };
    for (const key of Object.keys(cloned)) {
      if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
        cloned[key] = "[REDACTED]";
      }
    }
    return cloned;
  }
}
