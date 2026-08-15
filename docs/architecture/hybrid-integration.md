# Integración Hybrid (solo lectura)

> **Última actualización:** 2026-08-14  
> **Estado:** ✅ Implementado (contrato Hybrid Local API **v0.4.0**)  
> **Alcance:** consulta READ-ONLY vía API Local Hybrid, solo org Monddy

---

## Resumen

Marfyl expone un **proxy GET-only** hacia Hybrid Local API **v0.4.0**. No hay persistencia Prisma de datos Hybrid, no hay escrituras hacia Hybrid y no se expone `/tablas`.

| Capa | Comportamiento |
|------|----------------|
| Upstream | Hybrid Local API v0.4.0 — URL pública documentada: `https://db.marfyl.site` |
| Backend | `src/modules/hybrid/` — proxy autenticado |
| Frontend | Nav + páginas solo Monddy; llama solo al API Marfyl; combos vía `/hybrid/catalogos` (sin hardcode de tipos) |
| Ops | `HYBRID_API_BASE_URL` + `HYBRID_API_TOKEN` (local puede ya estar configurado; no inventar tokens) |

---

## Backend

**Módulo:** `marfyl-backend/src/modules/hybrid/`

### Rutas (prefijo API usual `/api`)

| Método | Ruta | Notas |
|--------|------|--------|
| GET | `/hybrid/connection` | **Solo SUPER_ADMIN**. Diagnóstico (sin gate Monddy): configured, host, latency, health |
| GET | `/hybrid/health` | Health del proxy / upstream (Monddy) |
| GET | `/hybrid/catalogos` | Catálogos (v0.4.0) |
| GET | `/hybrid/catalogos/:grupo` | Catálogo por grupo (v0.4.0) |
| GET | `/hybrid/monedas` | Monedas (v0.4.0) |
| GET | `/hybrid/inventario` | Lista (query allowlist) |
| GET | `/hybrid/inventario/:codigo` | Por código |
| GET | `/hybrid/clientes` | Query allowlist |
| GET | `/hybrid/existencia` | Query allowlist |
| GET | `/hybrid/ventas` | Query allowlist (incluye `caja`, `serie`) |
| GET | `/hybrid/ventas/:documento` | Detalle por documento |

**Ventas (v0.4.0):** la query allowlist de listado incluye `caja` y `serie`. El campo `serie` forma parte del contrato de ventas.

### Timeouts hacia Hybrid

| Caso | Timeout aproximado |
|------|--------------------|
| Listados / catálogos | ~60 s (default `HYBRID_API_TIMEOUT_MS`) |
| Detalle venta (`/hybrid/ventas/:documento`) | ~180 s |

### Auth y roles

- Guards: `JwtAuthGuard` → `OrganizationGuard` → `RolesGuard`
- Roles: `SUPER_ADMIN`, `ADMIN`, `MANAGER`
- Identidad de org: siempre desde `@ActiveOrganization()` (nunca desde query del cliente)
- No se reenvían headers del cliente hacia Hybrid; el Bearer (o X-API-Key) sale de env

### Orden de gates (upstream)

1. Org activa con slug ≠ Monddy (`HYBRID_ORG_SLUG` = `monddy` en código) → **404**
2. `HYBRID_API_BASE_URL` o `HYBRID_API_TOKEN` vacíos → **503**
3. Solo entonces se hace GET al upstream con query filtrada por allowlist

### Variables de entorno

Placeholders en `.env.example`:

| Variable | Uso |
|----------|-----|
| `HYBRID_API_BASE_URL` | Base URL del API Hybrid (p. ej. `https://db.marfyl.site`; **requerida en ops**) |
| `HYBRID_API_TOKEN` | Token hacia Hybrid (**requerida en ops**; no inventar valores) |
| `HYBRID_API_TIMEOUT_MS` | Timeout hacia Hybrid (default ~60000 para listados; detalle venta usa ~180000) |
| `HYBRID_AUTH_HEADER` | `bearer` (default) o `x-api-key` |

**Ops:** configurar `HYBRID_API_BASE_URL` y `HYBRID_API_TOKEN` en el `.env` del backend. En local pueden ya estar definidos; no documentar ni inventar tokens.

### Fuera de alcance (intencional)

- Sin Prisma persist de respuestas Hybrid
- Sin POST/PUT/PATCH/DELETE hacia Hybrid
- Sin endpoint `/tablas` en Marfyl

---

## Frontend

- Visible solo para org **Monddy** (slug `monddy`)
- Páginas: `/hybrid/ventas` (lista) y `/hybrid/ventas/[documento]` (detalle)
- Combos (p. ej. tipos) se cargan desde `/hybrid/catalogos` — **sin hardcode de tipos**
- Todas las llamadas van al API Marfyl (`/hybrid/...`); sin secretos Hybrid en el frontend (`NEXT_PUBLIC_*` Hybrid, tokens, etc.)

---

## Referencias de código

```
marfyl-backend/src/modules/hybrid/
marfyl-backend/src/common/founding-orgs.ts   # HYBRID_ORG_SLUG
marfyl-frontend/src/lib/api/hybrid.ts
marfyl-frontend/src/lib/hybrid/feature.ts
marfyl-frontend/src/app/(dashboard)/hybrid/ventas/
```

---

## Importación Hybrid → Marfyl (Adapter Pattern)

### Arquitectura

La importación de datos desde Hybrid a Marfyl utiliza el patrón **Adapter** para transformar los datos del formato Hybrid al formato Marfyl/Prisma.

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐
│   Frontend    │    │   Backend        │    │   Hybrid API     │
│              │    │                  │    │                  │
│  /hybrid/    │───▶│  HybridImport    │◀───│  GET /ventas     │
│  importar    │    │  Controller      │    │  GET /inventario  │
│              │    │       │          │    │  GET /clientes    │
│  [Seleccion] │    │       ▼          │    │                  │
│  [Importar]  │    │  HybridImport    │    └──────────────────┘
│  [Resultado] │    │  Service         │
│              │    │       │          │
└──────────────┘    │       ▼          │
                    │  ┌───────────┐   │
                    │  │ Adapters  │   │
                    │  │           │   │
                    │  │ Venta     │   │
                    │  │ Producto  │   │
                    │  │ Cliente   │   │
                    │  └─────┬─────┘   │
                    │        │         │
                    │        ▼         │
                    │  ┌───────────┐   │
                    │  │ Prisma    │   │
                    │  │ Invoice   │   │
                    │  │ Product   │   │
                    │  │ Customer  │   │
                    │  └───────────┘   │
                    └──────────────────┘
```

### Módulo NestJS

El módulo de importación vive en `src/modules/hybrid-import/` y es independiente del proxy `hybrid/`.

**Estructura:**
```
hybrid-import/
├── hybrid-import.module.ts
├── hybrid-import.controller.ts
├── hybrid-import.service.ts
├── adapters/
│   ├── hybrid-adapter.interface.ts
│   ├── dedup-keys.ts
│   ├── status.mapper.ts
│   ├── venta.adapter.ts
│   ├── producto.adapter.ts
│   └── cliente.adapter.ts
├── services/
│   └── entity-resolver.service.ts
└── types/
    ├── import-context.ts
    ├── hybrid-input.types.ts
    ├── hybrid-output.types.ts
    └── import-result.types.ts
```

### Adapter Interface

```typescript
interface HybridAdapter<TInput, TOutput> {
  transform(input: TInput, context: ImportContext): TOutput;
  getDedupKey(input: TInput): string;
  validate(input: TInput): ValidationResult;
}
```

| Adapter | Input | Output | Dedup Key |
|---------|-------|--------|-----------|
| VentaAdapter | HybridVentaDetailInput | CreateInvoiceFromHybridDto | `hybrid:{documento}` |
| ProductoAdapter | HybridProductoInput | CreateProductFromHybridDto | `sku:{codigo}` |
| ClienteAdapter | HybridClienteInput | CreateCustomerFromHybridDto | `taxId:{rif\|nit}` |

### Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/hybrid-import/ventas/preview` | Preview de todas las ventas pendientes |
| `POST` | `/hybrid-import/ventas/preview` | Preview de ventas específicas |
| `POST` | `/hybrid-import/ventas/confirm` | Confirmar importación |

### Deduplicación

| Tipo | Campo | Método |
|------|-------|--------|
| Venta | `legacyImportKey` | `@@unique([organizationId, legacyImportKey])` |
| Producto | `sku` | `@@unique([organizationId, sku])` |
| Cliente | `taxId` | Lookup por `taxId + organizationId` |

### Mapeo de Status

| Hybrid Status | Marfyl InvoiceStatus | Importable |
|---------------|---------------------|------------|
| 0 (Anulado) | CANCELLED | ❌ |
| 1 (Procesado) | PAID | ✅ |
| 2 (Anulado) | CANCELLED | ❌ |
| 5 (En proceso) | PENDING | ✅ |

### Frontend

La UI de importación está en `/hybrid/importar` y permite:

1. **Preview**: Cargar ventas de Hybrid y ver qué se importaría
2. **Selección**: Elegir ventas individuales o todas las listas
3. **Importación**: Confirmar y persistir en la DB de Marfyl
4. **Resultado**: Ver resumen de importadas, omitidas y errores

### Seguridad

- Solo **Super Admin** puede importar
- Solo orgs fundadoras tienen acceso (Monddy, Davean, El Rancho)
- Importación es **one-way** (Hybrid → Marfyl, nunca al revés)
- Transacciones Prisma para atomicidad
- Idempotencia via `legacyImportKey`

---

**Mantenido por:** Documentation Agent  
**Fuente:** contrato Hybrid Local API v0.4.0 + hechos aprobados (no inventar comportamiento adicional)
