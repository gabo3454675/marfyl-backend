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
| GET/POST | `/api/sales-import/*` | Import ventas Excel: `template`, `preview`, `confirm` (preview con proyección de stock `currentStock`/`stockDelta`/`finalStock`) |
| GET/POST | `/api/purchases-import/*` | Import compras Excel: `template`, `preview`, `confirm` (preview con proyección de stock `currentStock`/`stockDelta`/`finalStock`) |
| POST | `/api/assistant/chat` | Asistente IA |
| GET | `/api/hybrid/*` | Proxy READ-ONLY Hybrid (orgs fundadoras; ver docs) |

Rutas Hybrid (contrato v0.4.0): `health`, `catalogos`, `catalogos/:grupo`, `monedas`, `inventario`, `inventario/:codigo`, `clientes`, `existencia`, `ventas`, `ventas/:documento`. Ventas query: incluye `caja`, `serie`. Roles: SUPER_ADMIN, ADMIN, MANAGER. Detalle: [docs/architecture/hybrid-integration.md](./docs/architecture/hybrid-integration.md).

## Importación Excel

Los módulos `sales-import` (ventas), `purchases-import` (compras) e inventario (`POST /api/inventory/import`) importan desde archivos Excel. Los previews y confirms de ventas/compras reutilizan el mismo helper puro de proyección de stock ([`src/common/stock-projection.util.ts`](./src/common/stock-projection.util.ts), `projectStock`), de modo que preview y confirm siempre son consistentes.

### Proyección de stock en previews

Los previews de ventas y compras devuelven por línea `currentStock`, `stockDelta` y `finalStock`:

| Caso | `currentStock` | `stockDelta` | `finalStock` |
|------|----------------|--------------|--------------|
| Venta (producto con stock) | stock actual | `-quantity` (resta) | `currentStock - quantity` |
| Compra (producto existente) | stock actual | `+quantity` (suma) | `currentStock + quantity` |
| Compra (producto nuevo, `willCreate`) | `0` | `+quantity` | `quantity` |
| Servicio / combo (no afecta stock) | stock actual | `0` | `currentStock` |
| Sin match de producto | `null` | `null` | `null` |

- **Confirm ventas:** valida stock (error si `stock < quantity`, salvo `skipStockValidation=true`) y aplica el decrement; **confirm compras:** aplica el increment y actualiza `costPrice`. Ambos reutilizan `projectStock`.
- **Inventario (dry-run, `confirm=false`):** devuelve `currentStock` (stock actual en BD) solo para `action: "update"` (`null` para `create`/`skip`); el `stock` del archivo es el valor que se fijará (el Excel es la "fuente de verdad").

### Desglose fiscal en importaciones (TASK-007)

Los montos importados desde archivos Excel (ventas, compras, hybrid, invoice-upload) **ya incluyen IVA (16%)**. El sistema **no suma IVA adicional**, solo desglosa:

```
base = round2(monto / 1.16)
iva  = round2(monto - base)
```

Identidad exacta: `base + iva = monto` (sin redondeo adicional).

**Tabla de flujos afectados:**

| Flujo | Archivo | Cambio |
|-------|---------|--------|
| Ventas (preview/confirm) | `sales-import.service.ts` | `computeInvoiceTaxFromGross` (TASK-001) |
| Compras | `purchases-import.service.ts` | Desglose fiscal con `computeExpenseFiscal` (TASK-002) |
| Invoice-upload | `invoice-upload.service.ts` | `isExempt` + desglose fiscal (TASK-003) |
| Hybrid (líneas) | `venta.adapter.ts` | Desglose bruto en líneas (TASK-004) |
| POS frontend | Ya correcto (sin cambios) | Desglose por dentro (TASK-006) |
| Inventario | `inventory.service.ts` | Sin cambio (ya guardaba tal cual) |
| Products upload | `products.service.ts` | Sin cambio (ya guardaba tal cual) |

**Precedente:** `src/modules/fiscal/helpers/expense-fiscal.helper.ts:57-58`
```typescript
const baseGeneral = round2(amount / 1.16);
const ivaAmount = round2(amount - baseGeneral);
```

**Nota:** Inventario y products upload ya guardaban `costPrice`/`salePrice` tal cual sin desglose fiscal; no requirieron cambios de código.

### Trazabilidad de importación por archivo

| Origen | Entidad | Campos de trazabilidad |
|--------|---------|------------------------|
| Ventas | `Invoice` | `importSource: "fastreport"`, `isLegacyImport`, `legacyImportKey` (idempotencia) |
| Compras | `Expense` | `importKey` con prefijo `monddy-compra:` |
| Compras | `InventoryMovement` | Sin columna propia; su origen se deriva del `expense.importKey` |
| Inventario | `Product` | `importedViaFile` (`Boolean @default(false)`) — se marca `true` al confirmar el import masivo |

### Deuda técnica: migración manual de `importedViaFile`

La columna `products.importedViaFile` se aplicó con SQL manual (`prisma/migrations/manual_add_imported_via_file_to_product.sql`, vía `prisma db execute`) porque `prisma migrate dev` falla con **P3006** por una migración previa no aplicable (`20260323144000_soft_delete_contribuyente_declaraciones`).

**Consecuencia:** la migración manual **no queda registrada** en `_prisma_migrations`. Cuando se repare la migración rota, hay que reconciliar el historial con `prisma migrate resolve` (marcar la manual como aplicada y resolver la P3006) antes de generar nuevas migraciones.

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
│   ├── hybrid/       # Proxy GET-only Hybrid (orgs fundadoras)
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

Hybrid (proxy solo lectura, orgs fundadoras — Monddy, Davean, El Rancho —, API v0.4.0): `HYBRID_API_BASE_URL` (p. ej. `https://db.marfyl.site`), `HYBRID_API_TOKEN`, `HYBRID_API_TIMEOUT_MS` (~60s listados; detalle venta ~180s), `HYBRID_AUTH_HEADER`. Ops: BASE_URL + TOKEN (local puede ya estar configurado; no inventar tokens).

**NUNCA commitear .env al repositorio.**
