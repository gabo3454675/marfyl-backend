import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export interface ParsedDatabaseUrl {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

@Injectable()
export class BackupService implements OnModuleInit {
  private readonly logger = new Logger(BackupService.name);
  private s3Client: S3Client | null = null;
  private bucket: string | null = null;
  private backupPrefix = 'db-backups';

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const enableS3Backup = this.configService.get<string>('ENABLE_S3_BACKUP');
    if (enableS3Backup !== 'true') {
      this.logger.log('Backup a S3 deshabilitado (ENABLE_S3_BACKUP no es "true"). No se inicializa AWS ni pg_dump.');
      return;
    }

    const awsAccessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const awsSecretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
    const awsRegion = this.configService.get<string>('AWS_REGION');
    const awsBucket = this.configService.get<string>('AWS_S3_BUCKET');

    if (awsAccessKeyId && awsSecretAccessKey && awsRegion && awsBucket) {
      this.s3Client = new S3Client({
        region: awsRegion,
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      });
      this.bucket = awsBucket;
      this.logger.log('Backup S3 configurado correctamente');
    } else {
      this.logger.warn(
        'Backup a S3 habilitado pero faltan credenciales. Configure AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION y AWS_S3_BUCKET. El servicio arranca sin S3.',
      );
    }
  }

  /**
   * Parsea DATABASE_URL (postgresql://user:pass@host:port/dbname?schema=...)
   */
  parseDatabaseUrl(url: string): ParsedDatabaseUrl | null {
    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.replace(/^\//, '').split('?')[0];
      const database = pathname || 'postgres';
      const [user, password] = parsed.username
        ? [parsed.username, decodeURIComponent(parsed.password || '')]
        : ['', ''];

      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port || '5432',
        user,
        password,
        database,
      };
    } catch {
      return null;
    }
  }

  /**
   * Ejecuta pg_dump y devuelve la ruta del archivo temporal con el dump.
   */
  async runPgDump(): Promise<string> {
    const databaseUrl = this.configService.get<string>('DATABASE_URL');
    if (!databaseUrl) {
      throw new Error('DATABASE_URL no está definida');
    }

    const parsed = this.parseDatabaseUrl(databaseUrl);
    if (!parsed) {
      throw new Error('No se pudo parsear DATABASE_URL');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dumpFileName = `disis-backup-${timestamp}.sql`;
    const dumpPath = path.join(process.cwd(), 'tmp', dumpFileName);
    const tmpDir = path.dirname(dumpPath);

    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      // pg_dump con variables de entorno para no exponer password en args
      const env = {
        ...process.env,
        PGPASSWORD: parsed.password,
        PGUSER: parsed.user,
        PGHOST: parsed.host,
        PGPORT: parsed.port,
        PGDATABASE: parsed.database,
      };

      const pgDump = spawn('pg_dump', ['--no-owner', '--no-acl', '-F', 'p', '-f', dumpPath], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      pgDump.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      pgDump.on('close', (code) => {
        if (code === 0) {
          resolve(dumpPath);
        } else {
          try {
            if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath);
          } catch {}
          reject(new Error(`pg_dump falló (código ${code}): ${stderr || 'sin salida'}`));
        }
      });

      pgDump.on('error', (err) => {
        try {
          if (fs.existsSync(dumpPath)) fs.unlinkSync(dumpPath);
        } catch {}
        reject(err);
      });
    });
  }

  /**
   * Sube un archivo local a S3 en la ruta prefix/YYYY/MM/DD/filename.
   */
  async uploadToS3(localPath: string, key: string): Promise<string> {
    if (!this.s3Client || !this.bucket) {
      throw new Error('S3 no está configurado para backups');
    }

    const region = this.configService.get<string>('AWS_REGION');
    if (!region) {
      throw new Error('AWS_REGION no está definida; no se puede subir a S3');
    }

    const body = fs.readFileSync(localPath);
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const s3Key = `${this.backupPrefix}/${year}/${month}/${day}/${key}`;

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: body,
        ContentType: 'application/sql',
      }),
    );

    const baseUrl = this.configService.get<string>('AWS_S3_BASE_URL') ?? `https://${this.bucket}.s3.${region}.amazonaws.com`;
    return `${baseUrl}/${s3Key}`;
  }

  /**
   * Realiza backup completo: pg_dump -> subida a S3 y limpia archivo temporal.
   * No hace nada si ENABLE_S3_BACKUP no es 'true'.
   */
  async runBackup(): Promise<{ path: string; s3Url?: string; skipped?: boolean; message?: string }> {
    const enableS3Backup = this.configService.get<string>('ENABLE_S3_BACKUP');
    if (enableS3Backup !== 'true') {
      this.logger.log('Backup deshabilitado temporalmente');
      return { path: '', skipped: true, message: 'Backup deshabilitado temporalmente (ENABLE_S3_BACKUP no es "true")' };
    }

    this.logger.log('Iniciando backup de base de datos...');
    let dumpPath: string | undefined;

    try {
      dumpPath = await this.runPgDump();
      this.logger.log(`pg_dump completado: ${dumpPath}`);

      if (this.s3Client && this.bucket) {
        const fileName = path.basename(dumpPath);
        const s3Url = await this.uploadToS3(dumpPath, fileName);
        this.logger.log(`Backup subido a S3: ${s3Url}`);
        return { path: dumpPath, s3Url };
      }

      return { path: dumpPath };
    } finally {
      if (dumpPath && fs.existsSync(dumpPath)) {
        try {
          fs.unlinkSync(dumpPath);
        } catch (e) {
          this.logger.warn(`No se pudo eliminar archivo temporal: ${dumpPath}`, e);
        }
      }
    }
  }
}
