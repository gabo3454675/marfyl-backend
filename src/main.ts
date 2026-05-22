import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3001);
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3002');
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');

  // Servir archivos estáticos desde la carpeta uploads
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
  });

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
