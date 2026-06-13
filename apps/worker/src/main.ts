import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import { validateEnv } from './config/env';

/**
 * Punto de entrada del worker.
 *
 * A diferencia de la API, aquí se usa createApplicationContext: levanta el
 * sistema de inyección de dependencias de Nest SIN servidor HTTP. El worker
 * no atiende requests — consume jobs de Redis (BullMQ).
 */
async function bootstrap() {
  // Falla rápido si el entorno está mal (DATABASE_URL, REDIS_URL, WHISPER_URL…)
  // antes de conectar a nada — mismo principio que la API.
  validateEnv();

  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // docker stop → SIGTERM → cierre limpio

  Logger.log('Worker arrancado — consumiendo la cola `transcribe` (F4)', 'Bootstrap');

  // Ya no hace falta la promesa-ancla de F0: las conexiones de BullMQ a Redis
  // mantienen vivo el event loop mientras esperan jobs.
}

void bootstrap();
