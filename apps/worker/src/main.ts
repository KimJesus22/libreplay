import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Punto de entrada del worker.
 *
 * A diferencia de la API, aquí se usa createApplicationContext: levanta el
 * sistema de inyección de dependencias de Nest SIN servidor HTTP. El worker
 * no atiende requests — consume jobs de Redis (BullMQ, a partir de F4).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks(); // docker stop → SIGTERM → cierre limpio

  console.log('Worker arrancado — sin procesadores registrados todavía (F4)');

  // Sin consumidores BullMQ el event loop queda vacío y Node terminaría el
  // proceso de inmediato. Esta promesa que nunca resuelve lo mantiene vivo
  // para poder demostrar que arranca. SE BORRA en F4: las conexiones de
  // BullMQ a Redis mantendrán vivo el proceso por sí solas.
  await new Promise(() => undefined);
}

void bootstrap();
