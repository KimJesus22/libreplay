/**
 * Conexión a Redis para BullMQ, derivada de REDIS_URL.
 *
 * Compartida entre la API (productor) y el worker (consumidor) para que ambos
 * apunten al mismo Redis sin duplicar el parseo de la URL. BullMQ acepta las
 * opciones de conexión de ioredis; basta host + port para dev y prod (sin TLS
 * ni auth en el Redis local del compose).
 *
 * Las libs leen process.env directamente (no el schema zod de cada app): no
 * pueden importar desde apps/ — cada app ya valida REDIS_URL al arrancar.
 */
export interface RedisConnection {
  host: string;
  port: number;
}

export function redisConnection(): RedisConnection {
  // URL del tipo redis://host:port. URL nativa de Node valida el formato y
  // separa host/puerto sin un regex frágil.
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return {
    host: url.hostname,
    // Puerto por defecto de Redis si la URL lo omite.
    port: url.port ? Number(url.port) : 6379,
  };
}
