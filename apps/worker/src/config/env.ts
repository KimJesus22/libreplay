import { z } from 'zod';

/**
 * Validación de variables de entorno del WORKER al arrancar.
 *
 * El worker valida SU propio entorno (no reutiliza el schema de la API): es un
 * proceso aparte con necesidades distintas —no sirve HTTP ni firma JWT, pero sí
 * habla con whisper—. Mismo principio que la API: si falta algo, el proceso
 * muere al arrancar con la lista exacta, nunca a mitad de transcribir un video.
 */
const envSchema = z.object({
  // La lee Prisma; validarla aquí da un error legible al arrancar.
  DATABASE_URL: z.string().startsWith('postgresql://'),
  // Redis: el worker es el CONSUMIDOR de la cola `transcribe`.
  REDIS_URL: z.string().startsWith('redis://'),

  // --- Storage S3: el worker BAJA el MP4 del storage para extraer el audio ---
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),

  // --- Whisper (F4): contenedor de transcripción ---
  // URL del servicio HTTP de faster-whisper. En compose es http://whisper:8081.
  WHISPER_URL: z.url(),
  // Timeout de la petición de transcripción. Generoso por defecto (10 min): un
  // video largo en CPU tarda; el criterio §6.2 (5 min de video < 5 min) es para
  // el caso típico, no un tope duro de la request.
  WHISPER_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
});

export type WorkerEnv = z.infer<typeof envSchema>;

export function validateEnv(): WorkerEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${detail}`);
  }
  return parsed.data;
}
