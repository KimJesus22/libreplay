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
