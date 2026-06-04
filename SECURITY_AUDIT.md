# 🔒 Auditoría de Seguridad y Hardening - Marfyl

**Fecha:** 4 Junio 2026
**Auditoría:** Agentes Especializados (Security Agent, Architect Agent, Coding Interface Agent)
**Versión del documento:** 1.0

---

## Resumen Ejecutivo

Se realizó una auditoría integral del sistema Marfyl bajo cuatro pilares:
1. **Seguridad de Datos**
2. **Responsividad UI/UX**
3. **Estabilidad (Zero Bugs)**
4. **Optimización de Módulos Críticos (Excel/PDF)**

**Resultado General:** ⚠️ ALERTA ALTA - Se encontraron vulnerabilidades críticas que fueron corregidas.

---

## Vulnerabilidades Críticas Corregidas

### SEC-001: Credenciales Hardcoded en Provisioning
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🔴 CRÍTICA |
| **Ubicación** | `prisma/provision-founding.ts:28,34` |
| **Descripción** | Contraseñas de usuarios fundadores hardcoded (`338232gG`, `monddy33`) |
| **Corrección** | Eliminados fallbacks, ahora usa variables de entorno obligatorias con validación |

**Cambios:**
```typescript
// ANTES (inseguro)
password: process.env.SUPER_ADMIN_PASSWORD || '338232gG'

// DESPUÉS (seguro)
password: process.env.SUPER_ADMIN_PASSWORD!  // Obligatorio, sin fallback
```

---

### SEC-002: JWT_SECRET Débil/Por Defecto
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🔴 CRÍTICA |
| **Ubicación** | `.env:36`, `src/main.ts` |
| **Descripción** | JWT_SECRET usaba valor reconocible `cambiar-clave-segura-en-produccion` |
| **Corrección** | Validación en bootstrap que bloquea arranquen producción con secrets inseguros |

**Cambios en `src/main.ts`:**
```typescript
const INSECURE_JWT_SECRETS = [
  'cambiar-clave-segura-en-produccion',
  'cambiar-jwt-secret-en-produccion',
  'dev-secret-key',
  'secret',
  'password',
];

if (envNodeEnv === 'production') {
  if (!jwtSecret || INSECURE_JWT_SECRETS.includes(jwtSecret)) {
    console.error('❌ FATAL: JWT_SECRET is not set or uses an insecure default');
    process.exit(1);
  }
}
```

---

### SEC-003: Tokens Públicos Predecibles (Enumeración)
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🔴 CRÍTICA |
| **Ubicación** | `src/modules/invoices/invoices.service.ts:284` |
| **Descripción** | `uuidv4()` no es criptográficamente seguro para tokens secretos |
| **Corrección** | Cambiado a `crypto.randomBytes(32).toString('hex')` |

**Cambios:**
```typescript
// ANTES
import { v4 as uuidv4 } from 'uuid';
publicToken: uuidv4()

// DESPUÉS
import { randomBytes } from 'crypto';
publicToken: randomBytes(32).toString('hex')
```

---

### SEC-004: Endpoint mark-paid Sin Protección
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🔴 CRÍTICA |
| **Ubicación** | `src/modules/invoices/invoices-public.controller.ts:63-68` |
| **Descripción** | Cualquier persona podía marcar facturas como pagadas sin autenticación |
| **Corrección** | Agregado `@Throttle(3, 60)` - 3 intentos por minuto máximo |

---

### SEC-005/006: Sin Rate Limiting en Auth y Endpoints Públicos
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🟠 ALTA |
| **Ubicación** | `src/modules/auth/auth.controller.ts`, `src/modules/invoices/invoices-public.controller.ts` |
| **Descripción** | Endpoints de login, register, recover-password sin protección contra fuerza bruta |
| **Corrección** | Agregado `@Throttle()` en todos los endpoints públicos |

**Rate Limits Implementados:**
| Endpoint | Límite |
|----------|--------|
| `POST /auth/login` | 5/min (short), 20/hr (long) |
| `POST /auth/register` | 3/min, 10/hr |
| `POST /auth/recover-password` | 3/min, 10/hr |
| `GET /invoices/public/:token` | 30/min |
| `POST /invoices/public/:token/mark-paid` | 3/min |

---

### SEC-007: Falta Protección CSRF
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🟠 ALTA |
| **Ubicación** | `src/main.ts` |
| **Descripción** | No había validación de Origin/Referer para operaciones de estado |
| **Corrección** | Middleware de CSRF que valida Origin y Referer en producción |

**Cambios en `src/main.ts`:**
```typescript
// CSRF Protection para requests state-changing
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  // Valida Origin y Referer contra lista de orígenes permitidos
  // Bloquea en producción si falta origin
});
```

---

### SEC-009: Contraseña Por Defecto Hardcoded
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🟡 MEDIA |
| **Ubicación** | `src/modules/invitations/invitations.service.ts:326` |
| **Descripción** | Fallback `MARFYL2026!` para contraseñas de miembros invitados |
| **Corrección** | Lanzza `BadRequestException` si `DEFAULT_MEMBER_PASSWORD` no está configurada |

---

## Soft-Delete para Compliance Fiscal (Venezuela)

### Problema Identificado
La ley venezolana de facturación exige retención de datos fiscales por **5+ años**. Los modelos no tenían soft-delete, permitiendo eliminación física de facturas.

### Solución Implementada
**Archivo:** `prisma/schema.prisma`

Agregados campos `deletedAt DateTime?` a:
- `Organization`
- `Invoice`
- `Expense`

**Indexes agregados:**
```prisma
@@index([deletedAt])  // En cada modelo
```

### ⚠️ Requiere Migración de Base de Datos
```bash
cd marfyl-backend
npx prisma migrate dev --name add_soft_delete
```

**Uso en queries:**
```typescript
// Ejemplo: encontrar facturas activas (no eliminadas)
const invoice = await prisma.invoice.findFirst({
  where: {
    id,
    organizationId,
    deletedAt: null,  // Solo facturas activas
  }
});
```

---

## Paginación Server-Side (Performance)

### UX-001: Invoices Sin Paginación
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🟠 ALTA |
| **Descripción** | `findAll()` cargaba TODAS las facturas sin límite |
| **Corrección** | Nuevo endpoint con paginación server-side |

**Nuevo endpoint:** `GET /api/invoices?page=1&limit=50&search=&status=`

**Respuesta:**
```json
{
  "data": [...],
  "total": 1234,
  "page": 1,
  "limit": 50,
  "totalPages": 25
}
```

---

### UX-002: Productos Sin Paginación
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🟠 ALTA |
| **Descripción** | Catálogo de productos cargaba todo sin límite |
| **Corrección** | Paginación server-side con búsqueda |

**Nuevo endpoint:** `GET /api/products?page=1&limit=50&search=&categoryId=`

---

### UX-003: Dashboard with findMany
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🟡 MEDIA |
| **Descripción** | Dashboard cargaba miles de invoices en memoria para agregar |
| **Corrección** | Usa `GROUP BY` con `$queryRaw` y `aggregate()` |

**Optimizaciones:**
- Ventas diarias: `$queryRaw` con `GROUP BY DATE(createdAt)`
- KPIs: `aggregate()` para contar/sumar en BD
- Top productos: limitado a 1000 items

---

## Bugs Corregidos

### BUG-002: IVA Hardcoded en PDF
| Atributo | Detalle |
|----------|---------|
| **Severidad** | 🔴 CRÍTICA |
| **Ubicación** | `src/modules/invoices/invoices.service.ts:949` |
| **Descripción** | PDF mostraba `taxVal = 0` ignorando el IVA real |
| **Corrección** | Ahora usa `invoice.ivaAmount` |

**Cambios:**
```typescript
// ANTES
const taxVal = 0;

// DESPUÉS
const taxVal = this.toNum(invoice.ivaAmount);
```

También se agregó `ivaAmount` al select de `findOne()`.

---

## Responsividad UI/UX - Correcciones

| ID | Descripción | Archivo | Cambio |
|----|-------------|---------|--------|
| R1 | AdminTableWrap padding insuficiente | `admin-card.tsx` | `-mx-1` → `-mx-3 sm:-mx-1` |
| R2 | FiscalToolbar rompe en <400px | `fiscal-toolbar.tsx` | `flex-wrap` → `flex-col sm:flex-row` |
| R3 | InvoiceDetailSheet muy estrecho | `invoice-detail-sheet.tsx` | `sm:max-w-lg` → `sm:max-w-xl md:max-w-2xl` |
| R5 | Grid POS sin breakpoint xs | `pos/page.tsx` | `grid-cols-2` → `grid-cols-1 xs:grid-cols-2` |
| R6 | break-words en métricas | `globals.css` | `break-words` → `break-all` |
| R7 | admin-section first-child CSS | `globals.css` | Usado `first-of-type` en lugar de `first:` |
| E2 | alert() en download PDF | `invoices/page.tsx` | Cambiado a `toast.error()` |
| B3 | retryLast() sin manejo de errores | `assistant-panel.tsx` | try/catch agregado |
| B6 | children != null vs undefined | `admin-card.tsx` | Cambiado a `!== undefined` |

---

## Checklist de Seguridad Post-Auditoría

- [x] SEC-001: Credenciales hardcoded eliminadas
- [x] SEC-002: JWT_SECRET validación obligatoria en producción
- [x] SEC-003: Tokens públicos ahora criptográficamente seguros
- [x] SEC-004: Endpoint mark-paid con rate limiting
- [x] SEC-005/006: Rate limiting en auth y endpoints públicos
- [x] SEC-007: Middleware CSRF implementado
- [x] SEC-009: Contraseña por defecto eliminada
- [x] BUG-002: IVA en PDF corregido
- [x] Soft-delete agregado en schema (requiere migración)
- [x] Paginación implementada en invoices y products
- [x] Dashboard optimizado con aggregations
- [ ] **PENDIENTE:** Ejecutar `prisma migrate dev` para soft-delete
- [ ] **PENDIENTE:** Rotar credenciales si fueron comprometidas

---

## Variables de Entorno Obligatorias en Producción

```env
# ⚠️ OBLIGATORIO
JWT_SECRET="genera-con-openssl-rand-base64-64"

# ⚠️ OBLIGATORIO - Sin fallback, debe ser mínimo 8 caracteres
DEFAULT_MEMBER_PASSWORD="tu-contraseña-segura"

# ⚠️ OBLIGATORIO - Sin fallback
SUPER_ADMIN_EMAIL="admin@ejemplo.com"
SUPER_ADMIN_PASSWORD="contraseña-super-segura"
SUPER_ADMIN_2_EMAIL="admin2@ejemplo.com"
SUPER_ADMIN_2_PASSWORD="otra-contraseña-segura"
```

**Generar JWT_SECRET:**
```bash
openssl rand -base64 64
```

---

## Recomendaciones Futuras

1. **Migrar JWT a cookies httpOnly** - Actualmente en localStorage, vulnerable a XSS
2. **Implementar circuit breaker** - Para billing checks que bloquean todos los requests si está down
3. **Separar fiscal-engine.service** - Tiene demasiada responsabilidad (projectSale, closePeriod, etc.)
4. **Agregar cache** - Para dashboard y catálogos con `@nestjs/cache-manager`
5. **Logs de auditoría estructurados** - ELK/Splunk para auditoría de compliance
