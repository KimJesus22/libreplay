import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * Punto de entrada de la API.
 *
 * NestFactory.create(AppModule) construye la aplicación leyendo el "árbol de
 * módulos": AppModule declara qué controladores existen, y Nest registra una
 * ruta HTTP por cada decorador @Get/@Post que encuentra en ellos.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Swagger genera la documentación interactiva (criterio §8.3 del spec)
  // leyendo los mismos decoradores de los controladores. Cero esfuerzo extra:
  // documentar y programar son el mismo acto.
  const config = new DocumentBuilder()
    .setTitle('LibrePlay API')
    .setDescription('Streaming de video con catalogación por IA')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  // DEUDA: el puerto viene de process.env sin validar. Cuando haya más
  // variables (DB, Redis, S3...) hay que validarlas al arrancar con un schema
  // (p. ej. zod) para que la app falle ruidosamente si falta una, en vez de
  // explotar a mitad de un request. Pagar en F1.
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
  console.log(`API escuchando en http://localhost:${process.env.PORT ?? 3000}`);
}

void bootstrap();
