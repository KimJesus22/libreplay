import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';

/**
 * Configuración de la app compartida entre main.ts y los tests e2e: si el
 * test montara sus propios pipes "parecidos", probaría otra app distinta de
 * la que corre en producción.
 */
export function configureApp(app: INestApplication): void {
  // Valida los DTOs (class-validator) en todos los endpoints.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta propiedades que el DTO no declara
      transform: true, // convierte el body plano en instancia del DTO
    }),
  );
  // Sin esto req.cookies no existe y el refresh httpOnly no se puede leer.
  app.use(cookieParser());
}
