import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

/** 1 year in seconds for signed URL expiration */
const SIGNED_URL_EXPIRY = 31536000;

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private supabase: SupabaseClient | null = null;
  private bucket: string | null = null;
  /** Always defined: local folder when Supabase is not configured */
  private uploadsDir: string;

  constructor(private configService: ConfigService) {
    this.uploadsDir = path.join(process.cwd(), "uploads");

    const supabaseUrl = this.configService.get<string>("SUPABASE_URL");
    const supabaseKey = this.configService.get<string>(
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    const supabaseBucket = this.configService.get<string>("SUPABASE_BUCKET");

    if (supabaseUrl && supabaseKey && supabaseBucket) {
      this.supabase = createClient(supabaseUrl, supabaseKey);
      this.bucket = supabaseBucket;
      this.logger.log("Upload Supabase Storage configurado correctamente");
    } else {
      if (!fs.existsSync(this.uploadsDir)) {
        fs.mkdirSync(this.uploadsDir, { recursive: true });
      }
      this.logger.log(
        "Upload usando almacenamiento local (uploads/). Supabase no configurado o credenciales incompletas.",
      );
    }
  }

  /**
   * Sube un archivo a Supabase Storage o al sistema de archivos local
   * @param file Archivo de Multer
   * @param folder Carpeta donde guardar (ej: 'products', 'private/concert/payments')
   * @returns URL del archivo subido (signed URL para Supabase, URL publica para local)
   */
  async uploadFile(
    file: Express.Multer.File,
    folder: string = "uploads",
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException("Archivo no proporcionado");
    }

    // Validar tipo de archivo (solo imagenes)
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        "Tipo de archivo no permitido. Solo se permiten imagenes.",
      );
    }

    // Validar tamano (maximo 5MB)
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        "El archivo es demasiado grande. Maximo 5MB.",
      );
    }

    // Generar nombre unico para el archivo
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const extension = path.extname(file.originalname);
    const fileName = `${timestamp}-${randomString}${extension}`;
    const storagePath = `${folder}/${fileName}`;

    if (this.supabase && this.bucket) {
      return this.uploadToSupabase(file, storagePath);
    } else {
      return this.uploadToLocal(file, folder, fileName);
    }
  }

  /**
   * Sube archivo a Supabase Storage y retorna signed URL
   */
  private async uploadToSupabase(
    file: Express.Multer.File,
    storagePath: string,
  ): Promise<string> {
    const { error: uploadError } = await this.supabase!.storage
      .from(this.bucket!)
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (uploadError) {
      throw new BadRequestException(
        `Error al subir archivo a Supabase: ${uploadError.message}`,
      );
    }

    // Generar signed URL para lectura (bucket privado)
    const { data: signedUrlData, error: signedUrlError } =
      await this.supabase!.storage
        .from(this.bucket!)
        .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

    if (signedUrlError) {
      throw new BadRequestException(
        `Error al generar signed URL: ${signedUrlError.message}`,
      );
    }

    return signedUrlData.signedUrl;
  }

  /**
   * Sube archivo al sistema de archivos local
   */
  private async uploadToLocal(
    file: Express.Multer.File,
    folder: string,
    fileName: string,
  ): Promise<string> {
    const folderPath = path.join(this.uploadsDir, folder);

    // Crear carpeta si no existe
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const filePath = path.join(folderPath, fileName);

    // Guardar archivo
    fs.writeFileSync(filePath, file.buffer);

    // Retornar URL que sera servida estaticamente por NestJS
    const baseUrl = this.configService.get<string>(
      "BASE_URL",
      "http://localhost:3001",
    );
    return `${baseUrl}/uploads/${folder}/${fileName}`;
  }

  /**
   * Elimina un archivo de Supabase Storage o del sistema de archivos local
   */
  async deleteFile(fileUrl: string): Promise<void> {
    if (this.supabase && this.bucket) {
      const extractedPath = this.extractPathFromUrl(fileUrl);
      if (extractedPath) {
        const { error } = await this.supabase.storage
          .from(this.bucket)
          .remove([extractedPath]);

        if (error) {
          this.logger.warn(
            `No se pudo eliminar archivo de Supabase: ${error.message}`,
          );
        }
      }
    } else {
      // Eliminar archivo local
      const urlParts = fileUrl.split("/uploads/");
      if (urlParts.length > 1) {
        const relativePath = urlParts[1];
        const filePath = path.join(this.uploadsDir, relativePath);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }

  /**
   * Obtiene una signed URL para un archivo existente en Supabase Storage.
   * Util para el endpoint GET de comprobantes de pago.
   * @param storagePath Path del archivo en el bucket (ej: 'private/concert/payments/archivo.jpg')
   * @returns Signed URL con expiracion de 1 ano
   */
  async getSignedUrl(storagePath: string): Promise<string> {
    if (!this.supabase || !this.bucket) {
      // Fallback local: retornar URL directa
      const baseUrl = this.configService.get<string>(
        "BASE_URL",
        "http://localhost:3001",
      );
      return `${baseUrl}/uploads/${storagePath}`;
    }

    const { data, error } = await this.supabase.storage
      .from(this.bucket)
      .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);

    if (error) {
      throw new BadRequestException(
        `Error al generar signed URL: ${error.message}`,
      );
    }

    return data.signedUrl;
  }

  /**
   * Extrae el storage path de una URL firmada de Supabase o de una URL local.
   * Para signed URLs de Supabase: .../object/sign/{bucket}/{path}?token=...
   * Para URLs locales: .../uploads/{path}
   */
  public extractPathFromUrl(url: string): string | null {
    // Para signed URLs de Supabase
    const signedPattern = /\/object\/sign\/[^/]+\/(.+)\?/;
    const signedMatch = url.match(signedPattern);
    if (signedMatch) {
      return decodeURIComponent(signedMatch[1]);
    }

    // Para URLs de uploads locales
    const localPattern = /\/uploads\/(.+)$/;
    const localMatch = url.match(localPattern);
    if (localMatch) {
      return localMatch[1];
    }

    this.logger.warn(`No se pudo extraer path de la URL: ${url}`);
    return null;
  }
}