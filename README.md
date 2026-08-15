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
| GET | `/api/products/:id/variants` | Variantes de un producto |
| POST | `/api/products/:id/variants` | Crear variante |
| PATCH | `/api/products/variants/:variantId` | Actualizar variante |
| DELETE | `/api/products/variants/:variantId` | Eliminar variante |
| POST | `/api/invoices` | Crear factura |
| POST | `/api/assistant/chat` | Asistente IA |
| GET | `/api/hybrid/*` | Proxy READ-ONLY Hybrid (solo org Monddy; ver docs) |

Rutas Hybrid (contrato v0.4.0): `health`, `catalogos`, `catalogos/:grupo`, `monedas`, `inventario`, `inventario/:codigo`, `clientes`, `existencia`, `ventas`, `ventas/:documento`. Ventas query: incluye `caja`, `serie`. Roles: SUPER_ADMIN, ADMIN, MANAGER. Detalle: [docs/architecture/hybrid-integration.md](./docs/architecture/hybrid-integration.md).

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
│   ├── hybrid/       # Proxy GET-only Hybrid (Monddy)
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

Hybrid (proxy solo lectura, org Monddy, API v0.4.0): `HYBRID_API_BASE_URL` (p. ej. `https://db.marfyl.site`), `HYBRID_API_TOKEN`, `HYBRID_API_TIMEOUT_MS` (~60s listados; detalle venta ~180s), `HYBRID_AUTH_HEADER`. Ops: BASE_URL + TOKEN (local puede ya estar configurado; no inventar tokens).

**NUNCA commitear .env al repositorio.**
