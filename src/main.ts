import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { assertMarfylDatabaseUrl } from './common/database-guard';

async function bootstrap() {
  // SECURITY: Prevent DEV_PREVIEW_AUTH in production
  const envNodeEnv = process.env.NODE_ENV;
  const devPreviewAuth = process.env.DEV_PREVIEW_AUTH === 'true';
  const fiscalPreview = process.env.NEXT_PUBLIC_FISCAL_PREVIEW === 'true';

  if (envNodeEnv === 'production') {
    if (devPreviewAuth) {
      console.error('❌ FATAL: DEV_PREVIEW_AUTH must NOT be enabled in production (NODE_ENV=production)');
      process.exit(1);
    }
    if (fiscalPreview) {
      console.error('❌ FATAL: NEXT_PUBLIC_FISCAL_PREVIEW must NOT be enabled in production (NODE_ENV=production)');
      process.exit(1);
    }
    console.log('✅ Production security checks passed: DEV_PREVIEW flags are disabled');
  } else {
    if (devPreviewAuth) {
      console.warn('⚠️  WARNING: DEV_PREVIEW_AUTH is enabled (development mode)');
    }
  }

  assertMarfylDatabaseUrl(process.env.DATABASE_URL);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3002');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // Compression Gzip - Reduce el tamaño de las respuestas JSON hasta 70%
  app.use(compression());

  // CORS Configuration - Seguro para producción
  // En producción, solo acepta peticiones desde el dominio configurado
  // En desarrollo, acepta desde localhost
  const allowedOrigins: string[] = [];

  // Dominios de producción siempre permitidos (incl. variantes Render)
  const productionDomains: string[] = [];
  const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  productionDomains.push(...extraOrigins);

  if (nodeEnv === 'production') {
    // Agregar dominios de producción
    allowedOrigins.push(...productionDomains);

    // En producción, también aceptar desde el dominio configurado
    if (frontendUrl) {
      // Agregar el dominio principal
      allowedOrigins.push(frontendUrl);

      // Agregar variante con www si no la tiene
      if (frontendUrl.startsWith('https://')) {
        const domain = frontendUrl.replace('https://', '');
        if (!domain.startsWith('www.')) {
          allowedOrigins.push(`https://www.${domain}`);
        }
      }
    }
  } else {
    // En desarrollo, permitir localhost
    allowedOrigins.push(
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    );
    // También permitir dominios de producción en desarrollo para testing
    allowedOrigins.push(...productionDomains);
  }

  console.log('[CORS] NODE_ENV=', nodeEnv, 'allowedOrigins=', allowedOrigins.length, '(hostname check for marfyl-*-frontend*.onrender.com enabled)');

  app.enableCors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (health checks, Postman, mobile apps, servidor a servidor).
      // CORS solo aplica a peticiones de navegador con Origin; sin origin no es cross-origin.
      if (!origin) {
        return callback(null, true);
      }

      // Verificar si el origin está permitido (normalizar sin barra final por si el navegador la envía)
      const normalizedOrigin = origin.replace(/\/$/, '');
      const isInList = allowedOrigins.some(
        (allowed) => allowed.replace(/\/$/, '') === normalizedOrigin
      );
      // Permitir también por hostname (origen con puerto, preview deploys de Render, etc.)
      let isAllowedByHost = false;
      try {
        const url = new URL(origin);
        const h = url.hostname;
        isAllowedByHost =
          h.endsWith('.onrender.com') &&
          (h.startsWith('marfyl-') && h.includes('-frontend'));
      } catch {
        // ignore invalid URL
      }
      const isAllowed = isInList || isAllowedByHost;
      if (isAllowed) {
        callback(null, true);
      } else {
        console.error('[CORS] Rejected origin:', JSON.stringify(origin), 'Allowed:', allowedOrigins);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-tenant-id',
      'x-organization-id',
      'x-company-id',
    ],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  );

  // Global Prefix
  app.setGlobalPrefix('api');

  await app.listen(port);
}

bootstrap();