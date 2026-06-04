# Acceso lanzamiento — MARFYL

## Login real (no vista previa)

En `marfyl-frontend/.env.local`:

```env
NEXT_PUBLIC_FISCAL_PREVIEW=false
NEXT_PUBLIC_CONCERT_MOCK=false
```

Reinicia frontend y backend tras cambiar `.env`.

Si ves datos falsos: borra `auth-storage` y `marfyl_preview` en Local Storage del navegador.

---

## Admin general de plataforma

| Email | Contraseña | Uso |
|-------|------------|-----|
| **admin@marfyl.dev** | **MarfylAdmin2026!** | Ver **todas** las empresas, crear orgs, soporte |

```bash
cd marfyl-backend
pnpm provision:platform-admin
```

---

## Dueños fundadores (3 negocios)

| Email | Contraseña | Selector |
|-------|------------|----------|
| glonga10@gmail.com | `338232gG` | Rancho, Monddy, Davean |
| agpereir@gmail.com | `monddy33` | Rancho, Monddy, Davean |

```bash
pnpm provision:founding
```

Concierto / boletería: solo **Monddy Corp**.

---

## Clientes nuevos (registro con empresa)

1. Ir a http://localhost:3003/register
2. Completar: usuario + **nombre comercial** + **identificador** (slug)
3. Se crea cuenta + empresa con plan **BASIC** y rol **ADMIN**
4. Entrada directa al dashboard de **su** negocio (datos aislados)

Usuarios antiguos sin empresa: http://localhost:3003/onboarding

**Marfyl Demo eliminado** — no existe en producción.

---

## URLs

| Recurso | URL |
|---------|-----|
| App | http://localhost:3003/login |
| Registro | http://localhost:3003/register |
| Onboarding | http://localhost:3003/onboarding |
| Venta entradas (Monddy) | http://localhost:3003/evento/hemenegilda-capacidad |

---

## Datos por negocio (Neon)

| Negocio | Slug | Facturas | Productos |
|---------|------|----------|-------------|
| El Rancho de Germán | `el-rancho-de-german` | 30 | 22 |
| Monddy Corp | `monddy` | 30 | 22 |
| Davean | `davean` | 60 | 22 |

Inventario y stock son **por organización** (mismo catálogo base del restore, cantidades distintas).

---

## Scripts de mantenimiento

```bash
pnpm provision:platform-admin
pnpm provision:founding
psql $DATABASE_URL -f scripts/delete-marfyl-demo.sql   # si reaparece demo
```

Modelo SaaS: `docs/MODELO-SAAS-Y-ROLES.md`
