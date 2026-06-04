-- MARFYL — Base de datos local (PostgreSQL 14+)
-- Ejecutar en pgAdmin conectado como usuario "postgres" (contraseña de la instalación).
-- Si el usuario o la BD ya existen, ignore los errores "already exists" y continúe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'marfyl_user') THEN
    CREATE USER marfyl_user WITH PASSWORD 'marfyl_password';
  ELSE
    ALTER USER marfyl_user WITH PASSWORD 'marfyl_password';
  END IF;
END
$$;

-- Si marfyl_db ya existe, omita esta línea:
CREATE DATABASE marfyl_db OWNER marfyl_user;

GRANT ALL PRIVILEGES ON DATABASE marfyl_db TO marfyl_user;
