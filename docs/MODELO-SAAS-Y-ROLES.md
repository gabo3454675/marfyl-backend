# Modelo SaaS MARFYL

## Tipos de usuario

### 1. Admin general de plataforma (`isSuperAdmin`)

- **Cuenta:** `admin@marfyl.dev` → `pnpm provision:platform-admin`
- Ve **todas** las empresas en el selector.
- Crea organizaciones desde Configuración (`POST /tenants`).

### 2. Dueño fundador (multi-negocio)

- **Cuentas:** `glonga10@gmail.com`, `agpereir@gmail.com` → `pnpm provision:founding`
- Ve solo: Rancho, Monddy, Davean (`billingExempt`, plan ENTERPRISE).
- Concierto solo en Monddy.

### 3. Cliente SaaS (paga / se registra)

Flujo actual implementado:

```mermaid
flowchart LR
  A["/register"] --> B["Usuario + empresa"]
  B --> C["Plan BASIC + rol ADMIN"]
  C --> D["Dashboard tenant aislado"]
```

| Paso | Qué pasa |
|------|----------|
| Registro | `POST /api/auth/register` con `organizationName` y `organizationSlug` |
| Empresa | Org nueva, `billingExempt: false`, `plan: BASIC` |
| Acceso | JWT con `organizationId`; inventario/facturas solo de su org |
| Sin empresa previa | `POST /api/auth/setup-organization` vía `/onboarding` |

Slugs reservados: fundadores (`el-rancho-de-german`, `monddy`, `davean`) y lista en `src/common/org-slug.ts`.

Planes `FREE` sin exención quedan bloqueados por `OrganizationBillingService` hasta activar suscripción.

---

## Multi-tenant

Cada fila operativa lleva `organizationId` (o `tenantId` en movimientos de inventario). No hay mezcla entre negocios.

---

## Marfyl Demo

**Eliminado.** No se usa en seeds ni en login. Histórico migrado a Davean (`scripts/migrate-marfyl-demo-to-davean.sql`, ya aplicado).

Para borrar restos en BD: `scripts/delete-marfyl-demo.sql`.

---

## API relevante

| Método | Ruta | Público |
|--------|------|---------|
| POST | `/auth/register` | Sí — usuario + empresa |
| POST | `/auth/setup-organization` | JWT — completar alta |
| POST | `/auth/login` | Sí |
| GET | `/tenants/organizations-all` | Super admin |
