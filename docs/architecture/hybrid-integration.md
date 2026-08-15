# Integración Hybrid (solo lectura)

> **Última actualización:** 2026-08-14  
> **Estado:** ✅ Implementado (ops: completar credenciales en `.env`)  
> **Alcance:** TASK-007 — consulta READ-ONLY vía API Local Hybrid, solo org Monddy

---

## Resumen

Marfyl expone un **proxy GET-only** hacia Hybrid Local API. No hay persistencia Prisma de datos Hybrid, no hay escrituras hacia Hybrid y no se expone `/tablas`.

| Capa | Comportamiento |
|------|----------------|
| Backend | `src/modules/hybrid/` — proxy autenticado |
| Frontend | Nav + páginas solo Monddy; llama solo al API Marfyl |
| Ops | Falta rellenar `HYBRID_API_BASE_URL` y `HYBRID_API_TOKEN` reales en backend `.env` |

---

## Backend

**Módulo:** `marfyl-backend/src/modules/hybrid/`

### Rutas (prefijo API usual `/api`)

| Método | Ruta | Notas |
|--------|------|--------|
| GET | `/hybrid/health` | Health del proxy / upstream |
| GET | `/hybrid/inventario` | Lista (query allowlist) |
| GET | `/hybrid/inventario/:codigo` | Por código |
| GET | `/hybrid/clientes` | Query allowlist |
| GET | `/hybrid/existencia` | Query allowlist |
| GET | `/hybrid/ventas` | Query allowlist |
| GET | `/hybrid/ventas/:documento` | Detalle por documento |

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
| `HYBRID_API_BASE_URL` | Base URL del API Hybrid (**requerida en ops**) |
| `HYBRID_API_TOKEN` | Token hacia Hybrid (**requerida en ops**) |
| `HYBRID_API_TIMEOUT_MS` | Timeout hacia Hybrid (default ejemplo `120000`) |
| `HYBRID_AUTH_HEADER` | `bearer` (default) o `x-api-key` |

**Criterio ops pendiente:** rellenar valores reales de `HYBRID_API_BASE_URL` y `HYBRID_API_TOKEN` en el `.env` del backend.

### Fuera de alcance (intencional)

- Sin Prisma persist de respuestas Hybrid
- Sin POST/PUT/PATCH/DELETE hacia Hybrid
- Sin endpoint `/tablas`

---

## Frontend

- Visible solo para org **Monddy** (slug `monddy`)
- Páginas: `/hybrid/ventas` (lista) y `/hybrid/ventas/[documento]` (detalle)
- Todas las llamadas van al API Marfyl (`/hybrid/...`); timeout cliente **150s**
- **Sin** secretos Hybrid en el frontend (`NEXT_PUBLIC_*` Hybrid, tokens, etc.)

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

**Mantenido por:** Documentation Agent  
**Fuente:** hechos aprobados TASK-007 (no inventar comportamiento adicional)
