# 🔒 Configuración de Producción - Marfyl Backend

**Última actualización:** 4 Junio 2026

---

## ✅ Seguridad Implementada

### 1. CORS Configurado (`src/main.ts`)
- ✅ Acepta SOLAMENTE peticiones desde orígenes configurados en producción
- ✅ Usa `process.env.FRONTEND_URL` y `CORS_ALLOWED_ORIGINS` para configuración dinámica
- ✅ En desarrollo permite localhost (puertos 3000-3003)
- ✅ Rechaza requests de orígenes no autorizados en producción
- ✅ Headers personalizados para multi-tenant

### 2. Validación de JWT_SECRET (`src/main.ts`)
- ✅ Bloquea arranque si `JWT_SECRET` usa valores inseguros por defecto
- ✅ Valida contra lista de secrets conocidos inseguros
- ✅ En producción: `process.exit(1)` si el secret es débil

**Secrets bloqueados:**
```typescript
const INSECURE_JWT_SECRETS = [
  'cambiar-clave-segura-en-produccion',
  'cambiar-jwt-secret-en-produccion',
  'dev-secret-key',
  'secret',
  'password',
];
```

### 3. Rate Limiting (`@nestjs/throttler`)
- ✅ Login: 5/min, 20/hr
- ✅ Register: 3/min, 10/hr
- ✅ Password Recovery: 3/min, 10/hr
- ✅ Endpoints públicos de facturas: 30/min
- ✅ mark-paid: 3/min (protege contra abuso)

### 4. Protección CSRF (`src/main.ts`)
- ✅ Valida `Origin` y `Referer` en requests state-changing (POST/PUT/PATCH/DELETE)
- ✅ Solo bloquea en producción si falta origin
- ✅whitelist de orígenes permitidos

### 5. Tokens Criptográficamente Seguros
- ✅ Tokens públicos de facturas: `crypto.randomBytes(32).toString('hex')`
- ✅ Tokens de invitación: `randomBytes(32)` (ya estaba)

---

## 📋 Variables de Entorno Obligatorias

### Producción
```env
# Backend
PORT=3001
NODE_ENV=production

# Base de datos
DATABASE_URL="postgresql://..."

# Autenticación - OBLIGATORIO
# Generar con: openssl rand -base64 64
JWT_SECRET="tu-secret-seguro-aqui"
JWT_EXPIRES_IN=365d

# Frontend/CORS - OBLIGATORIO
FRONTEND_URL="https://tu-dominio.com"
# Separar múltiples orígenes con coma
# CORS_ALLOWED_ORIGINS=https://otro-dominio.com,https://mas.com

# Contraseñas de admins - OBLIGATORIO (sin fallback)
SUPER_ADMIN_EMAIL="admin@tu-dominio.com"
SUPER_ADMIN_PASSWORD="contraseña-super-segura-1"
SUPER_ADMIN_2_EMAIL="admin2@tu-dominio.com"
SUPER_ADMIN_2_PASSWORD="contraseña-super-segura-2"

# Contraseña miembros invitados - OBLIGATORIO (sin fallback)
DEFAULT_MEMBER_PASSWORD="minimo-8-caracteres"
```

### Desarrollo
```env
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://..."

# En desarrollo se permiten fallbacks para conveniencia
# pero se muestran WARNINGS en consola
JWT_SECRET="cambiar-clave-segura-en-produccion"  # Muestra warning
```

---

## 🔐 Hardening de Seguridad

### Contraseñas
- ✅ bcrypt con saltRounds=10
- ✅ No hay contraseñas hardcoded en código
- ✅ Validación de passwords mínimos en provisión

### Multi-Tenant
- ✅ `organizationId` solo del JWT, nunca de headers
- ✅ `OrganizationGuard` valida membresía activa
- ✅ Filtros `organizationId` en TODOS los queries Prisma

### Soft-Delete (Compliance Fiscal Venezuela)
- ✅ Campos `deletedAt` en `Organization`, `Invoice`, `Expense`
- ✅ **Requiere migración:** `npx prisma migrate dev --name add_soft_delete`

---

## 📝 Checklist de Despliegue

- [ ] Configurar `DATABASE_URL` con credenciales reales
- [ ] Generar `JWT_SECRET` seguro: `openssl rand -base64 64`
- [ ] Configurar `FRONTEND_URL` con el dominio del frontend
- [ ] Configurar `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_PASSWORD`
- [ ] Configurar `SUPER_ADMIN_2_EMAIL` y `SUPER_ADMIN_2_PASSWORD`
- [ ] Configurar `DEFAULT_MEMBER_PASSWORD` (mínimo 8 caracteres)
- [ ] Ejecutar migraciones: `pnpm prisma migrate deploy`
- [ ] **Ejecutar migración de soft-delete:** `pnpm prisma migrate dev --name add_soft_delete`
- [ ] Verificar que NODE_ENV=production
- [ ] Verificar logs de inicio: `pm2 logs marfyl-backend`

---

## 🚨 Errores Comunes y Soluciones

### "JWT_SECRET is not set or uses an insecure default"
```bash
# Generar secret seguro
openssl rand -base64 64
# Poner el resultado en JWT_SECRET
```

### "DEFAULT_MEMBER_PASSWORD must be configured"
```bash
# Agregar a .env
DEFAULT_MEMBER_PASSWORD="tu-contraseña-de-8-o-mas-caracteres"
```

### "SUPER_ADMIN_PASSWORD or SUPER_ADMIN_2_PASSWORD not configured"
```bash
# Agregar a .env
SUPER_ADMIN_EMAIL="tu-email@ejemplo.com"
SUPER_ADMIN_PASSWORD="contraseña-segura"
SUPER_ADMIN_2_EMAIL="otro-email@ejemplo.com"
SUPER_ADMIN_2_PASSWORD="otra-contraseña-segura"
```

---

## 📞 Troubleshooting

### Request bloqueado por CORS
1. Verificar que `FRONTEND_URL` tiene el protocolo `https://`
2. Verificar que el frontend usa HTTPS
3. Agregar orígenes adicionales en `CORS_ALLOWED_ORIGINS`

### Request bloqueado por CSRF
1. Verificar que el frontend envía `Origin` header
2. Verificar que el origin está en `FRONTEND_URL` o `CORS_ALLOWED_ORIGINS`

### Rate limit excedido
- Esperar el tiempo de reset (indicado en headers `Retry-After`)
- En desarrollo: reducir límites o deshabilitar throttling temporalmente

---

## 🔧 Comandos de Verificación

```bash
# Verificar que el servidor inicia correctamente
pm2 logs marfyl-backend

# Verificar configuración de CORS (buscar "CORS" en logs)
pm2 logs marfyl-backend | grep CORS

# Verificar JWT_SECRET (buscar "JWT_SECRET" en logs al iniciar)
pm2 logs marfyl-backend | grep JWT_SECRET

# Ejecutar migraciones
pnpm prisma migrate deploy

# Regenerar cliente Prisma después de cambios
pnpm prisma generate
```
