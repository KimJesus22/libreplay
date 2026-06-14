import { z } from 'zod';

/**
 * Validación de variables de entorno al arrancar (deuda pagada de F0).
 *
 * Solo se valida lo que la API consume HOY: validar variables que nadie lee
 * todavía (REDIS_URL, S3_*...) daría falsa sensación de cobertura y obligaría
 * a definirlas en entornos que no las usan. Cada fase añade aquí las suyas.
 *
 * Si falta algo, la app muere en el arranque con la lista exacta de errores —
 * nunca a mitad de un request en producción.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  // La lee Prisma directamente, pero validarla aquí da un error legible al
  // arrancar en vez del stacktrace de conexión de Prisma.
  DATABASE_URL: z.string().startsWith('postgresql://'),
  // 16 chars mínimo: rechaza secretos vacíos o de juguete sin impedir el
  // placeholder de .env.example en dev.
  JWT_SECRET: z.string().min(16),

  // Redis para BullMQ (F4): la API es PRODUCTOR — al confirmar una subida
  // encola el job `transcribe`. Validarla aquí da un error legible al arrancar
  // en vez de fallar al primer /confirm en producción.
  REDIS_URL: z.string().startsWith('redis://'),

  // --- Storage S3 (F2): MinIO en dev, Cloudflare R2 en prod ---
  S3_ENDPOINT: z.url(),
  // Endpoint que va DENTRO de las URLs prefirmadas. Difiere del anterior
  // cuando la API corre en compose: ella alcanza MinIO como http://minio:9000
  // pero el cliente (navegador/host) necesita http://localhost:9000 — y la
  // firma S3 incluye el host, así que no se puede reescribir después.
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // Límite de subida configurable por env (plan.md §8).
  MAX_VIDEO_SIZE_MB: z.coerce.number().int().positive().default(500),

  // --- Ollama (F5): la API embebe la QUERY de la búsqueda semántica con el
  // mismo bge-m3 que indexó los videos en el worker. No genera metadata (eso
  // es del worker), por eso aquí no va METADATA_MODEL. ---
  OLLAMA_URL: z.url(),
  EMBED_MODEL: z.string().min(1).default('bge-m3'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${detail}`);
  }
  return parsed.data;
}
