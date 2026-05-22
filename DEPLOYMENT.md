# 🚀 Guía de Despliegue - DISIS API

## Arquitectura de Producción

- **Frontend**: Vercel (HTTPS) - `https://[DOMINIO]`
- **Backend**: AWS EC2 con Nginx + SSL (HTTPS) - `https://api.[DOMINIO]`
- **Base de Datos**: AWS RDS PostgreSQL o PostgreSQL en EC2

## 📋 Pasos de Despliegue

### 1. Preparar el Servidor EC2

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 18+ y pnpm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm

# Instalar PostgreSQL (si no usas RDS)
sudo apt install -y postgresql postgresql-contrib

# Instalar Nginx
sudo apt install -y nginx

# Instalar PM2 para gestión de procesos
sudo npm install -g pm2
```

### 2. Configurar Base de Datos

```bash
# Conectar a PostgreSQL
sudo -u postgres psql

# Crear base de datos y usuario
CREATE DATABASE disis_db;
CREATE USER disis_user WITH ENCRYPTED PASSWORD 'TU_PASSWORD_SEGURO';
GRANT ALL PRIVILEGES ON DATABASE disis_db TO disis_user;
\q
```

### 3. Desplegar el Código

```bash
# Clonar repositorio o subir código
cd /home/ubuntu
git clone TU_REPOSITORIO disis-api
cd disis-api/apps/server

# Instalar dependencias
pnpm install

# Copiar template de .env
cp .env.production.template .env

# Editar .env con tus valores reales
nano .env
```

### 4. Ejecutar Migraciones

```bash
cd apps/server
pnpm prisma generate
pnpm prisma migrate deploy
```

### 5. Configurar Nginx

```bash
# Copiar configuración
sudo cp nginx/disis-api.conf /etc/nginx/sites-available/disis-api

# Editar y reemplazar [DOMINIO] con tu dominio real
sudo nano /etc/nginx/sites-available/disis-api

# Crear enlace simbólico
sudo ln -s /etc/nginx/sites-available/disis-api /etc/nginx/sites-enabled/

# Verificar configuración
sudo nginx -t

# Reiniciar Nginx
sudo systemctl restart nginx
```

### 6. Configurar SSL con Let's Encrypt

```bash
# Instalar Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtener certificado SSL
sudo certbot --nginx -d api.[DOMINIO] -d www.api.[DOMINIO]

# Verificar renovación automática
sudo certbot renew --dry-run
```

### 7. Iniciar la Aplicación con PM2

```bash
cd /home/ubuntu/disis-api/apps/server

# Construir la aplicación
pnpm build

# Iniciar con PM2
pm2 start dist/main.js --name disis-api

# Configurar PM2 para iniciar al arrancar el sistema
pm2 startup
pm2 save

# Ver logs
pm2 logs disis-api
```

### 8. Configurar Firewall

```bash
# Permitir puertos necesarios
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirige a HTTPS)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 9. Crear Carpeta de Uploads

```bash
mkdir -p /home/ubuntu/disis-api/apps/server/uploads
chmod 755 /home/ubuntu/disis-api/apps/server/uploads
```

## 🔧 Comandos Útiles

### Reiniciar la aplicación
```bash
pm2 restart disis-api
```

### Ver estado
```bash
pm2 status
pm2 logs disis-api
```

### Reiniciar Nginx
```bash
sudo systemctl restart nginx
```

### Ver logs de Nginx
```bash
sudo tail -f /var/log/nginx/disis-api-access.log
sudo tail -f /var/log/nginx/disis-api-error.log
```

## 🔒 Seguridad

1. **Cambiar JWT_SECRET**: Usa un secret único y seguro
2. **Configurar firewall**: Solo abrir puertos necesarios
3. **Actualizar regularmente**: `sudo apt update && sudo apt upgrade`
4. **Backups de base de datos**: Configurar backups automáticos
5. **Monitoreo**: Configurar alertas y monitoreo

## 📝 Notas Importantes

- Reemplaza `[DOMINIO]` con tu dominio real en todos los archivos
- El frontend debe configurar `NEXT_PUBLIC_API_URL=https://api.[DOMINIO]/api`
- Los certificados SSL se renuevan automáticamente con Certbot
- PM2 reinicia automáticamente la app si se cae
