import {
  Injectable,
  NestMiddleware,
  BadRequestException,
} from "@nestjs/common";
import { Request, Response, NextFunction } from "express";

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly allowedOrigins: string[];

  constructor() {
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3002";
    const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    this.allowedOrigins = [
      frontendUrl,
      ...extraOrigins,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
    ];
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

    if (origin && !this.isOriginAllowed(origin)) {
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
        const refererUrl = new URL(referer);
        const refererOrigin = refererUrl.origin;
        if (!this.isOriginAllowed(refererOrigin)) {
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
        // Invalid referer URL, let it pass in dev
        if (process.env.NODE_ENV === "production") {
          throw new BadRequestException(
            "CSRF validation failed: invalid referer",
          );
        }
      }
    }

    next();
  }

  private isOriginAllowed(origin: string): boolean {
    const normalizedOrigin = origin.replace(/\/$/, "");
    return this.allowedOrigins.some(
      (allowed) => allowed.replace(/\/$/, "") === normalizedOrigin,
    );
  }
}
