# MARFYL Backend

API REST para la plataforma MARFYL-VF — gestión fiscal y facturación para Venezuela.

## Stack

- **Framework:** NestJS
- **ORM:** Prisma
- **Base de datos:** PostgreSQL 17 + pgvector
- **Autenticación:** JWT
- **Email:** Resend
- **IA:** Groq + HuggingFace

## Inicio Rápido

```bash
# Instalar dependencias
pnpm install

# Configurar BD local
cp .env.example .env
# Editar DATABASE_URL en .env

# Aplicar migraciones
pnpm prisma:deploy

# Sembrar datos
pnpm seed

# Iniciar
pnpm start:dev
```

El servidor arranca en `http://localhost:3001`.

## Endpoints Principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/public/db-ping` | Health check |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/register` | Registro |
| GET | `/api/dashboard/summary` | Resumen dashboard |
| GET | `/api/products` | Lista productos |
| POST | `/api/invoices` | Crear factura |
| POST | `/api/assistant/chat` | Asistente IA |

## Estructura

```
src/
├── modules/          # Módulos de negocio
│   ├── auth/         # Autenticación
│   ├── invoices/     # Facturación
│   ├── products/     # Productos
│   ├── fiscal/       # Motor fiscal
│   ├── assistant/    # Asistente IA
│   ├── concert/      # Boletería
│   └── ...
├── common/           # Infraestructura compartida
│   ├── guards/       # JWT, roles, tenant
│   ├── prisma/       # Servicio Prisma
│   └── auditoria/    # Logging
└── main.ts           # Bootstrap
```

## Scripts

```bash
pnpm prisma:deploy      # Aplicar migraciones
pnpm prisma:generate    # Generar Prisma Client
pnpm seed               # Sembrar datos
pnpm build              # Build producción
pnpm start:dev          # Desarrollo con watch
```

## Variables de Entorno

Ver `.env.example` para la lista completa.

**NUNCA commitear .env al repositorio.**
