import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '@app/prisma';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { VideosModule } from './videos/videos.module';

/**
 * Módulo raíz: el "índice" de la aplicación.
 *
 * En NestJS todo vive dentro de módulos. Cada feature del plan (auth, videos,
 * catalog...) será su propio módulo importado aquí. Por ahora:
 * - PrismaModule (global): acceso a Postgres para toda la app.
 * - TerminusModule: infraestructura de health checks para /health.
 * - AuthModule (F1): endpoints /auth/* y los guards globales JWT + roles.
 * - VideosModule (F2): subida por presigned PUT y gestión del uploader.
 */
@Module({
  imports: [PrismaModule, TerminusModule, AuthModule, VideosModule],
  controllers: [HealthController],
})
export class AppModule {}
