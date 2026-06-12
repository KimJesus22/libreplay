// Carga .env ANTES de cualquier otro import (los imports se ejecutan en
// orden): en dev `nest start` no lee .env solo; en Docker/prod las variables
// ya vienen del entorno y dotenv no pisa nada.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './config/env';

/**
 * Punto de entrada de la API.
 *
 * NestFactory.create(AppModule) construye la aplicación leyendo el "árbol de
 * módulos": AppModule declara qué controladores existen, y Nest registra una
 * ruta HTTP por cada decorador @Get/@Post que encuentra en ellos.
 */
async function bootstrap() {
  // Si falta una variable, morir AQUÍ con la lista de errores — no a mitad
  // de un request (deuda de F0, pagada).
  const env = validateEnv();

  const app = await NestFactory.create(AppModule);
  configureApp(app);

  // Swagger genera la documentación interactiva (criterio §8.3 del spec)
  // leyendo los mismos decoradores de los controladores. Cero esfuerzo extra:
  // documentar y programar son el mismo acto.
  const config = new DocumentBuilder()
    .setTitle('LibrePlay API')
    .setDescription('Streaming de video con catalogación por IA')
    .setVersion('0.2.0')
    // Habilita el botón "Authorize" para probar endpoints protegidos
    // pegando el accessToken que devuelve /auth/login.
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));

  await app.listen(env.PORT, '0.0.0.0');
  console.log(`API escuchando en http://localhost:${env.PORT}`);
}

void bootstrap();
