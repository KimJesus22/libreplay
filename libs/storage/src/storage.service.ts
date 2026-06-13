import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Lo que /confirm necesita saber del objeto subido. */
export interface StoredObject {
  sizeBytes: number;
}

/**
 * Único punto de contacto con el storage S3 (plan.md §3: lib `storage`).
 * En dev habla con MinIO y en prod con Cloudflare R2 — mismo SDK, solo
 * cambian endpoint y credenciales por env (decisión plan.md §2).
 *
 * Lee process.env directamente y no el schema zod de la API: las libs no
 * pueden importar desde apps/ (sería una dependencia invertida), y cada app
 * consumidora (api hoy, worker en F4) ya valida su entorno al arrancar.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket = process.env.S3_BUCKET as string;

  // Cliente "interno": operaciones servidor→storage (head, delete, bucket).
  private readonly client = new S3Client(StorageService.baseConfig());
  // Cliente "público": SOLO firma URLs. Usa el endpoint que el cliente final
  // puede alcanzar (ver S3_PUBLIC_ENDPOINT en config/env.ts) — la firma S3
  // incluye el host, así que reescribir la URL después la invalidaría.
  private readonly signer = new S3Client({
    ...StorageService.baseConfig(),
    endpoint: process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT,
  });

  private static baseConfig() {
    return {
      endpoint: process.env.S3_ENDPOINT,
      // R2/MinIO no usan regiones reales, pero el SDK exige una.
      region: 'auto',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY as string,
        secretAccessKey: process.env.S3_SECRET_KEY as string,
      },
      // Desactiva los checksums CRC32 que el SDK v3 añade por defecto
      // ('WHEN_SUPPORTED'). Dos razones: (1) en una URL prefirmada meterían
      // headers `x-amz-checksum-*` que el navegador no calcula ni envía en
      // el PUT directo, así que R2/MinIO rechazarían la subida; (2) ese
      // cálculo carga un módulo por import() dinámico que rompe bajo el VM de
      // Jest. R2 valida integridad por su cuenta — no necesitamos el trailer.
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      // MinIO sirve buckets como rutas (host/bucket/key), no como subdominios
      // (bucket.host/key). Sin esto, el SDK intentaría resolver
      // `videos.localhost` y fallaría.
      forcePathStyle: true,
    };
  }

  /**
   * Garantiza que el bucket exista al arrancar — `docker compose up` debe
   * dejar el entorno usable sin pasos manuales (criterio §6.5). En prod el
   * bucket de R2 ya existe (se crea en su consola) y esto es un no-op.
   */
  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.logger.log(`Bucket "${this.bucket}" no existe, creándolo...`);
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  /**
   * URL prefirmada para que el cliente suba con PUT directo al storage —
   * los bytes del video JAMÁS pasan por la API (plan.md §3). Content-Type y
   * Content-Length quedan dentro de la firma: si el cliente manda otros
   * valores, el storage rechaza la petición con 403.
   */
  presignedPutUrl(
    key: string,
    contentType: string,
    contentLength: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      {
        // 1 h: de sobra para iniciar la subida (el PUT en curso no se corta
        // al expirar la firma), y corto para que una URL filtrada caduque.
        expiresIn: 3600,
        // Sin esto, el SDK NO mete content-type en la firma (solo
        // content-length y host): el storage aceptaría cualquier tipo y el
        // objeto quedaría con un Content-Type equivocado, rompiendo el
        // streaming en F3. Forzándolo a firmarse, un PUT con otro tipo → 403.
        signableHeaders: new Set(['content-type']),
      },
    );
  }

  /**
   * URL prefirmada de LECTURA (GET) para el reproductor (F3, criterio §6.1).
   * El `<video>` la usa como `src` y emite `Range: bytes=...` directo contra
   * el storage → `206 Partial Content` sin que los bytes pasen por la API.
   * Range NO va en la firma: S3 permite el header sin firmarlo, que es justo
   * lo que necesita el navegador para hacer seek sobre una URL ya emitida.
   *
   * TTL largo (2 h, plan.md §3): debe cubrir la reproducción completa más el
   * seek; si expira a mitad, el `<video>` cortaría. Se firma por reproducción,
   * no se cachea — una URL filtrada caduca sola.
   */
  presignedGetUrl(key: string, expiresInS = 7200): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInS },
    );
  }

  /** Datos del objeto, o null si (aún) no existe — base de /confirm. */
  async headObject(key: string): Promise<StoredObject | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return { sizeBytes: head.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  /** Idempotente: borrar lo que no existe no es un error en S3. */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
