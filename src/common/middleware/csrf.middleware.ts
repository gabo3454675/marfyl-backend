import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import {
  buildCsrfAllowedOrigins,
  isMarfylAllowedOrigin,
  parseExtraOrigins,
} from "@/common/utils/cors-origin.util";

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly allowedOrigins: string[];

  constructor() {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3002";
    this.allowedOrigins = buildCsrfAllowedOrigins(
      frontendUrl,
      parseExtraOrigins(process.env.CORS_ALLOWED_ORIGINS),
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    if (
      req.method === "GET" ||
      req.method === "HEAD" ||
      req.method === "OPTIONS"
    ) {
      return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;

    if (!origin && !referer) {
      if (process.env.NODE_ENV === "production") {
        console.error(
          "[CSRF] Blocked request without Origin/Referer:",
          req.method,
          req.path,
        );
        throw new BadRequestException("CSRF validation failed: missing origin");
      }
      return next();
    }

    if (origin && !isMarfylAllowedOrigin(origin, this.allowedOrigins)) {
      console.error(
        "[CSRF] Blocked request with disallowed origin:",
        origin,
        req.method,
        req.path,
      );
      throw new BadRequestException(
        "CSRF validation failed: origin not allowed",
      );
    }

    if (referer) {
      try {
        const refererOrigin = new URL(referer).origin;
        if (!isMarfylAllowedOrigin(refererOrigin, this.allowedOrigins)) {
          console.error(
            "[CSRF] Blocked request with disallowed referer:",
            refererOrigin,
            req.method,
            req.path,
          );
          throw new BadRequestException(
            "CSRF validation failed: referer not allowed",
          );
        }
      } catch {
        if (process.env.NODE_ENV === "production") {
          throw new BadRequestException(
            "CSRF validation failed: invalid referer",
          );
        }
      }
    }

    next();
  }
}
