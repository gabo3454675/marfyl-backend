import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestExpressApplication } from "@nestjs/platform-express";
import * as compression from "compression";
import { AppModule } from "./app.module";
import { assertMarfylDatabaseUrl } from "./common/database-guard";
import { PrismaExceptionFilter } from "./common/filters/prisma-exception.filter";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { WebSocketService } from "./services/websocket";

async function bootstrap() {
  // SECURITY: Prevent DEV_PREVIEW_AUTH in production
  const envNodeEnv = process.env.NODE_ENV;
  const devPreviewAuth = process.env.DEV_PREVIEW_AUTH === "true";
  const fiscalPreview = process.env.NEXT_PUBLIC_FISCAL_PREVIEW === "true";
  const jwtSecret = process.env.JWT_SECRET;

  // Bloquear JWT_SECRET por defecto en producción
  const INSECURE_JWT_SECRETS = [
    "cambiar-clave-segura-en-produccion",
    "cambiar-jwt-secret-en-produccion",
    "dev-secret-key",
    "secret",
    "password",
  ];

  if (envNodeEnv === "production") {
    if (devPreviewAuth) {
      console.error(
        "❌ FATAL: DEV_PREVIEW_AUTH must NOT be enabled in production (NODE_ENV=production)",
      );
      process.exit(1);
    }
    if (fiscalPreview) {
      console.error(
        "❌ FATAL: NEXT_PUBLIC_FISCAL_PREVIEW must NOT be enabled in production (NODE_ENV=production)",
      );
      process.exit(1);
    }
    if (!jwtSecret || INSECURE_JWT_SECRETS.includes(jwtSecret)) {
      console.error(
        "❌ FATAL: JWT_SECRET is not set or uses an insecure default value in production",
      );
      console.error(
        "   Generate a secure secret with: openssl rand -base64 64",
      );
      process.exit(1);
    }
    console.log(
      "✅ Production security checks passed: DEV_PREVIEW flags are disabled and JWT_SECRET is configured",
    );
  } else {
    if (devPreviewAuth) {
      console.warn(
        "⚠️  WARNING: DEV_PREVIEW_AUTH is enabled (development mode)",
      );
    }
    if (!jwtSecret || INSECURE_JWT_SECRETS.includes(jwtSecret)) {
      console.warn(
        "⚠️  WARNING: JWT_SECRET uses an insecure default value. Change it for production!",
      );
    }
  }

  assertMarfylDatabaseUrl(process.env.DATABASE_URL);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT", 3001);
  const frontendUrl = configService.get<string>(
    "FRONTEND_URL",
    "http://localhost:3002",
  );
  const nodeEnv = configService.get<string>("NODE_ENV", "development");

  // Compression Gzip - Reduce el tamaño de las respuestas JSON hasta 70%
  app.use(compression());

  // CORS Configuration - Seguro para producción
  // En producción, solo acepta peticiones desde el dominio configurado
  // En desarrollo, acepta desde localhost
  const allowedOrigins: string[] = [];

  // Dominios de producción siempre permitidos (incl. variantes Render)
  const productionDomains: string[] = [];
  const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  productionDomains.push(...extraOrigins);

  if (nodeEnv === "production") {
    // Agregar dominios de producción
    allowedOrigins.push(...productionDomains);

    // En producción, también aceptar desde el dominio configurado
    if (frontendUrl) {
      // Agregar el dominio principal
      allowedOrigins.push(frontendUrl);

      // Agregar variante con www si no la tiene
      if (frontendUrl.startsWith("https://")) {
        const domain = frontendUrl.replace("https://", "");
        if (!domain.startsWith("www.")) {
          allowedOrigins.push(`https://www.${domain}`);
        }
      }
    }
  } else {
    // En desarrollo, permitir localhost
    allowedOrigins.push(
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
    );
    // También permitir dominios de producción en desarrollo para testing
    allowedOrigins.push(...productionDomains);
  }

  console.log(
    "[CORS] NODE_ENV=",
    nodeEnv,
    "allowedOrigins=",
    allowedOrigins.length,
    "(hostname check for marfyl.site and marfyl-*-frontend*.onrender.com enabled)",
  );

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (health checks, Postman, mobile apps, servidor a servidor).
      // CORS solo aplica a peticiones de navegador con Origin; sin origin no es cross-origin.
      if (!origin) {
        return callback(null, true);
      }

      // Verificar si el origin está permitido (normalizar sin barra final por si el navegador la envía)
      const normalizedOrigin = origin.replace(/\/$/, "");
      const isInList = allowedOrigins.some(
        (allowed) => allowed.replace(/\/$/, "") === normalizedOrigin,
      );
      // Permitir también por hostname (origen con puerto, preview deploys de Render, etc.)
      let isAllowedByHost = false;
      try {
        const url = new URL(origin);
        const h = url.hostname;
        isAllowedByHost =
          h === "marfyl.site" ||
          h.endsWith(".marfyl.site") ||
          (h.endsWith(".onrender.com") &&
            h.startsWith("marfyl-") &&
            h.includes("-frontend"));
      } catch {
        // ignore invalid URL
      }
      const isAllowed = isInList || isAllowedByHost;
      if (isAllowed) {
        callback(null, true);
      } else {
        console.error(
          "[CORS] Rejected origin:",
          JSON.stringify(origin),
          "Allowed:",
          allowedOrigins,
        );
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-tenant-id",
      "x-organization-id",
      "x-company-id",
    ],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
  });

  // CSRF Protection: Validate Origin header for state-changing requests
  app.use((req: any, res: any, next: any) => {
    if (
      req.method === "GET" ||
      req.method === "HEAD" ||
      req.method === "OPTIONS"
    ) {
      return next();
    }

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const nodeEnv = process.env.NODE_ENV;

    if (!origin && !referer) {
      if (nodeEnv === "production") {
        console.error(
          "[CSRF] Blocked request without Origin/Referer:",
          req.method,
          req.path,
        );
        return res.status(400).json({
          statusCode: 400,
          message: "CSRF validation failed: missing origin",
        });
      }
      return next();
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3002";
    const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
      .split(",")
      .map((o: string) => o.trim())
      .filter(Boolean);
    const allowedOrigins = [
      frontendUrl,
      ...extraOrigins,
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3003",
    ];

    const isOriginAllowed = (origin: string) => {
      const normalized = origin.replace(/\/$/, "");
      return allowedOrigins.some((o) => o.replace(/\/$/, "") === normalized);
    };

    if (origin && !isOriginAllowed(origin)) {
      console.error(
        "[CSRF] Blocked request with disallowed origin:",
        origin,
        req.method,
        req.path,
      );
      return res.status(400).json({
        statusCode: 400,
        message: "CSRF validation failed: origin not allowed",
      });
    }

    if (referer) {
      try {
        const refererUrl = new URL(referer);
        const refererOrigin = refererUrl.origin;
        if (!isOriginAllowed(refererOrigin)) {
          console.error(
            "[CSRF] Blocked request with disallowed referer:",
            refererOrigin,
            req.method,
            req.path,
          );
          return res.status(400).json({
            statusCode: 400,
            message: "CSRF validation failed: referer not allowed",
          });
        }
      } catch {
        if (nodeEnv === "production") {
          return res.status(400).json({
            statusCode: 400,
            message: "CSRF validation failed: invalid referer",
          });
        }
      }
    }

    next();
  });

  // AllExceptionsFilter is registered FIRST so its @Catch() (no args) wins
  // and acts as the outer catch for every unhandled exception, including
  // Prisma errors that PrismaExceptionFilter would otherwise handle.
  // In NestJS, filters are evaluated in registration order with first-match
  // semantics (see packages/core/exceptions/exceptions-handler.ts), so a
  // catch-all registered first always handles the response.
  app.useGlobalFilters(new AllExceptionsFilter(), new PrismaExceptionFilter());

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Prefix
  app.setGlobalPrefix("api");

  await app.init();
  const httpServer = app.getHttpServer();
  app.get(WebSocketService).attachToServer(httpServer);

  await app.listen(port);
  console.log(
    `🚀 MARFYL API listening on port ${port} (WebSocket /chat enabled)`,
  );
}

bootstrap();
