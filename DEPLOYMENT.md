# 🚀 Guía de Despliegue - Marfyl Backend

**Última actualización:** 4 Junio 2026

## Arquitectura de Producción

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

## 📋 Pasos de Despliegue

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

# Instalar dependencias
pnpm install

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
