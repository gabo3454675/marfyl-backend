# 🚀 Guía de Despliegue - Marfyl Backend

**Última actualización:** 4 Junio 2026
# MARFYL Backend

Guía de despliegue del backend de **MARFYL** (SaaS multi-tenant).

- **Frontend**: Next.js 14 (Vercel o similar) - HTTPS requerido
- **Backend**: NestJS en Node.js (Render, Railway, AWS, etc.) - Puerto 3001
- **Base de Datos**: PostgreSQL (Neon, Supabase, AWS RDS, etc.)
- **Storage**: AWS S3 (opcional, para backups y archivos)

## Requisitos Previos

- Node.js 18+
- pnpm 8+
- PostgreSQL 14+
- Dominio con SSL configurado

---
## Stack

- **Framework**: NestJS 10
- **ORM**: Prisma 5.10
- **Base de datos**: PostgreSQL (Neon)
- **Autenticación**: JWT con expiración de 365 días
- **Multi-tenant**: aislamiento por header `x-tenant-id`
- **Runtime**: Node.js

### 1. Preparar el Entorno

```bash
# Verificar Node.js y pnpm
node --version  # >= 18.0.0
pnpm --version  # >= 8.0.0

# Si no tienes pnpm
npm install -g pnpm
```

### 2. Clonar y Configurar

```bash
cd marfyl-backend
## Comandos

Desarrollo y operación del backend:

| Comando              | Descripción                                  |
| -------------------- | -------------------------------------------- |
| `pnpm dev`           | Levanta el servidor con `nest start --watch` |
| `pnpm build`         | Compila el proyecto con `nest build`         |
| `pnpm start:prod`    | Ejecuta el build con `node dist/main`        |
| `pnpm prisma:generate` | Genera el cliente de Prisma                |
| `pnpm prisma:migrate` | Aplica migraciones a la base de datos       |
| `pnpm prisma:seed`   | Ejecuta el seed inicial de datos             |

## Variables de entorno

Configurar estas variables antes de levantar el servicio:

| Variable         | Descripción                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`   | URL de conexión a PostgreSQL/Neon (con `?sslmode=require`)       |
| `PORT`           | Puerto HTTP del servicio (Render lo inyecta automáticamente)     |
| `NODE_ENV`       | `development` \| `production`                                    |
| `JWT_SECRET`     | Clave secreta para firmar tokens JWT                             |
| `JWT_EXPIRES_IN` | Tiempo de expiración del token (formato NestJS, ej. `365d`)      |
| `FRONTEND_URL`   | URL del frontend (usada para CORS y redirecciones)               |

Notas:
- `DATABASE_URL` debe apuntar al pooler de Neon en producción.
- `JWT_SECRET` debe ser único por entorno. Nunca commitear el valor real.
- `FRONTEND_URL` debe coincidir exactamente con el origen del frontend (incluido el esquema).

## Despliegue

### Render (principal)

El backend se despliega en **Render free tier** bajo el dominio `*.onrender.com`.

**Build command**

```bash
pnpm install && pnpm build
```

(`pnpm build` ya ejecuta `prisma generate` internamente.)

**Start command**

```bash
pnpm prisma:deploy && pnpm start:prod
```

**Pasos**

1. Crear un nuevo **Web Service** en Render conectado al repositorio.
2. Configurar las variables de entorno listadas arriba.
3. Definir los comandos de build y start según corresponda.
4. Render expone el servicio en `https://<service-name>.onrender.com`.
5. Verificar que `FRONTEND_URL` apunte al frontend desplegado.

Consideraciones del free tier:
- El servicio entra en sleep tras inactividad; la primera request puede tardar.
- El filesystem es efímero: cualquier archivo subido se pierde en redeploys.
- Configurar health check contra la ruta raíz o `/api/v1` si está disponible.

# Generar Prisma Client
pnpm prisma generate
```

### 3. Configurar Variables de Entorno

```bash
# Copiar template
cp .env .env.production

# Editar con valores reales
nano .env.production
```

**Variables obligatorias:**
```env
# Producción
NODE_ENV=production
PORT=3001

# Base de datos
DATABASE_URL="postgresql://usuario:password@host:5432/marfyl_db?sslmode=require"

# JWT - GENERAR CON: openssl rand -base64 64
JWT_SECRET="(pegar resultado del comando openssl)"

# Frontend
FRONTEND_URL="https://tu-dominio.com"

# Admin credentials - SIN FALLBACK
SUPER_ADMIN_EMAIL="admin@tu-dominio.com"
SUPER_ADMIN_PASSWORD="(contraseña segura)"
SUPER_ADMIN_2_EMAIL="admin2@tu-dominio.com"
SUPER_ADMIN_2_PASSWORD="(contraseña segura)"

# Contraseña miembros - SIN FALLBACK
DEFAULT_MEMBER_PASSWORD="(mínimo 8 caracteres)"
```

### 4. Generar JWT_SECRET Seguro

```bash
# Linux/Mac
openssl rand -base64 64

# Windows PowerShell
[Convert]::ToBase64String((1..64 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

### 5. Ejecutar Migraciones

```bash
# Desarrollo
pnpm prisma migrate dev

# Producción (sin confirmar - usa migrate deploy)
pnpm prisma migrate deploy

# Migración de soft-delete (NUEVO - post auditoría)
pnpm prisma migrate dev --name add_soft_delete
```

### 6. Construir la Aplicación

```bash
pnpm build
```

### 7. Iniciar con PM2

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Iniciar la aplicación
pm2 start dist/main.js --name marfyl-backend

# Guardar configuración de PM2
pm2 save

# Configurar inicio automático
pm2 startup
```

### 8. Verificar el Despliegue

```bash
# Ver estado
pm2 status

# Ver logs
pm2 logs marfyl-backend

# Probar health check
curl http://localhost:3001/api/health
```

---

## 🔒 Hardening de Seguridad Post-Despliegue

### 1. Verificar JWT_SECRET
Al iniciar en producción, el servidor **rechazará arrancar** si el JWT_SECRET es inseguro.

### 2. Verificar CORS
Los orígenes no autorizados serán rechazados. Verificar que `FRONTEND_URL` es correcto.

### 3. Verificar Rate Limiting
Los endpoints de autenticación tienen límites por minuto/hora. Ver logs si ves errores 429.

### 4. Soft-Delete Activado
Las facturas, gastos y organizaciones ahora usan soft-delete. No se eliminarán físicamente.

---

## 🔧 Comandos de Mantenimiento

### Reiniciar la aplicación
```bash
pm2 restart marfyl-backend
```

### Ver logs en tiempo real
```bash
pm2 logs marfyl-backend --tail 100
```

### Escalar horizontalmente
```bash
# En múltiples CPU cores
pm2 start dist/main.js -i max --name marfyl-backend
```

### Actualizar sin downtime
```bash
git pull origin main
pnpm install
pnpm prisma migrate deploy
pnpm build
pm2 restart marfyl-backend
```

### Backup de base de datos
```bash
# PostgreSQL con pg_dump
pg_dump -h host -U usuario -d marfyl_db -F c -b -v -f backup_$(date +%Y%m%d).dump
```

---

## 🚨 Notas Importantes

1. **NUNCA** subas el archivo `.env` al repositorio
2. **NUNCA** uses valores por defecto para contraseñas en producción
3. **Siempre** usa HTTPS en producción (frontend y backend)
4. **Ejecuta** `prisma migrate deploy` después de cada actualización del schema
5. **Monitorea** los logs de PM2 regularmente

---

## 🆘 Troubleshooting

### "JWT_SECRET is not set or uses an insecure default"
```bash
# Generar nuevo secret
openssl rand -base64 64
# Actualizar .env y reiniciar
pm2 restart marfyl-backend
```

### "Cannot find module dist/main.js"
```bash
# Rebuild
pnpm build
pm2 restart marfyl-backend
```

### "Connection refused" en base de datos
1. Verificar que PostgreSQL está corriendo
2. Verificar `DATABASE_URL` en .env
3. Verificar firewall permite conexión al puerto de PostgreSQL

### CORS errors en producción
1. Verificar `FRONTEND_URL` incluye `https://`
2. Verificar que el frontend usa HTTPS
3. Agregar orígenes adicionales en `CORS_ALLOWED_ORIGINS`
### Nginx VPS (alternativo)

Para deployments en VPS propio usando **Nginx** como reverse proxy.

**Configuración mínima de Nginx** (`/etc/nginx/sites-available/marfyl-backend`):

```nginx
server {
    listen 80;
    server_name api.tu-dominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Pasos**

1. Construir el proyecto: `pnpm install && pnpm prisma:generate && pnpm build`.
2. Copiar el build al VPS y configurar las variables de entorno.
3. Ejecutar migraciones: `pnpm prisma:migrate deploy`.
4. Iniciar el proceso (PM2 o systemd) con `node dist/main`.
5. Activar el sitio en Nginx y reiniciar el servicio.
6. Terminar TLS con Let's Encrypt (Certbot) si se requiere HTTPS.

## Operaciones

- **Migrar base de datos**: usar `pnpm prisma:migrate deploy` en producción.
- **Regenerar cliente Prisma**: requerido tras cambios en `schema.prisma`.
- **Revisar logs**: según el host (Render dashboard, `pm2 logs`, `journalctl`, etc.).

## Seguridad

- Rotar `JWT_SECRET` si se sospecha compromiso.
- Restringir CORS al `FRONTEND_URL` configurado.
- Forzar HTTPS en cualquier deployment expuesto a internet.
- No commitear archivos `.env`; usar el gestor de secretos del host.
