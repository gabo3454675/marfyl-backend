# 🔒 Configuración de Producción - DISIS API

## ✅ Archivos Generados

### 1. CORS Configurado (`apps/server/src/main.ts`)
- ✅ Acepta SOLAMENTE peticiones desde `https://[DOMINIO]` y `https://www.[DOMINIO]` en producción
- ✅ Usa `process.env.FRONTEND_URL` para configuración dinámica
- ✅ En desarrollo permite localhost
- ✅ Rechaza requests sin origin en producción (más seguro)
- ✅ Headers personalizados para multi-tenant

### 2. Configuración Nginx (`apps/server/nginx/disis-api.conf`)
- ✅ Escucha en `api.[DOMINIO]`
- ✅ Proxy pass a `localhost:3001`
- ✅ Headers para WebSockets y Proxy real
- ✅ SSL/TLS configurado
- ✅ Redirección HTTP → HTTPS
- ✅ Headers de seguridad (HSTS, X-Frame-Options, etc.)
- ✅ Servir archivos estáticos directamente desde Nginx
- ✅ CORS para archivos estáticos

### 3. Template .env (`apps/server/env.production.example`)
- ✅ Variables de entorno para producción
- ✅ `DATABASE_URL` para base de datos `disis_db`
- ✅ `FRONTEND_URL` configurado
- ✅ `JWT_SECRET` con instrucciones
- ✅ Configuración opcional de AWS S3

## 📋 Instrucciones de Uso

### Paso 1: Configurar Variables de Entorno

```bash
cd apps/server
cp env.production.example .env
nano .env
```

**Reemplaza `[DOMINIO]` con tu dominio real en:**
- `FRONTEND_URL=https://[DOMINIO]`
- `BASE_URL=https://api.[DOMINIO]`

**Ejemplo si tu dominio es `tudominio.com`:**
```env
FRONTEND_URL=https://tudominio.com
BASE_URL=https://api.tudominio.com
```

### Paso 2: Configurar Nginx

```bash
# Copiar configuración
sudo cp apps/server/nginx/disis-api.conf /etc/nginx/sites-available/disis-api

# Editar y reemplazar [DOMINIO]
sudo nano /etc/nginx/sites-available/disis-api
# Busca y reemplaza TODAS las instancias de [DOMINIO] con tu dominio real

# Activar sitio
sudo ln -s /etc/nginx/sites-available/disis-api /etc/nginx/sites-enabled/

# Verificar configuración
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
```

### Paso 3: Configurar SSL

```bash
# Instalar Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtener certificado (reemplaza [DOMINIO] con tu dominio)
sudo certbot --nginx -d api.[DOMINIO] -d www.api.[DOMINIO]
```

### Paso 4: Verificar CORS

El código ya está configurado para:
- ✅ Aceptar solo desde `https://[DOMINIO]` y `https://www.[DOMINIO]` en producción
- ✅ Rechazar cualquier otro origin
- ✅ Permitir credenciales (cookies, headers de autenticación)

## 🔐 Seguridad Implementada

1. **CORS Restrictivo**: Solo acepta tu dominio en producción
2. **HTTPS Forzado**: Nginx redirige HTTP a HTTPS
3. **Headers de Seguridad**: HSTS, X-Frame-Options, etc.
4. **SSL/TLS Moderno**: Solo TLS 1.2 y 1.3
5. **Proxy Real IP**: Nginx pasa la IP real del cliente al backend

## 📝 Checklist de Despliegue

- [ ] Reemplazar `[DOMINIO]` en `.env` con tu dominio real
- [ ] Reemplazar `[DOMINIO]` en `nginx/disis-api.conf` con tu dominio real
- [ ] Configurar `DATABASE_URL` con credenciales reales
- [ ] Generar `JWT_SECRET` seguro (mínimo 32 caracteres)
- [ ] Configurar certificado SSL con Let's Encrypt
- [ ] Verificar que Nginx está funcionando: `sudo nginx -t`
- [ ] Verificar que la app está corriendo: `pm2 status`
- [ ] Probar CORS desde el frontend
- [ ] Verificar logs: `pm2 logs disis-api`

## 🚨 Importante

1. **Nunca** subas el archivo `.env` al repositorio
2. **Siempre** usa HTTPS en producción
3. **Genera** un `JWT_SECRET` único y seguro
4. **Reemplaza** `[DOMINIO]` en TODOS los archivos antes de desplegar
5. **Verifica** que el firewall solo permite puertos necesarios

## 📞 Troubleshooting

### CORS Error en Producción
- Verifica que `FRONTEND_URL` en `.env` tiene el dominio correcto
- Verifica que el frontend está usando HTTPS
- Revisa logs: `pm2 logs disis-api`

### Nginx no inicia
- Verifica sintaxis: `sudo nginx -t`
- Revisa logs: `sudo tail -f /var/log/nginx/error.log`

### SSL no funciona
- Verifica que el dominio apunta a tu servidor
- Verifica que los puertos 80 y 443 están abiertos
- Revisa certificados: `sudo certbot certificates`
