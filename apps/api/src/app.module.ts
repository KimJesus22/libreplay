import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TerminusModule } from '@nestjs/terminus';
import { PrismaModule } from '@app/prisma';
import { redisConnection } from '@app/queue';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { HealthController } from './health/health.controller';
import { SearchModule } from './search/search.module';
import { StreamModule } from './stream/stream.module';
import { VideosModule } from './videos/videos.module';

/**
 * Módulo raíz: el "índice" de la aplicación.
 *
 * En NestJS todo vive dentro de módulos. Cada feature del plan (auth, videos,
 * catalog...) será su propio módulo importado aquí. Por ahora:
 * - PrismaModule (global): acceso a Postgres para toda la app.
 * - TerminusModule: infraestructura de health checks para /health.
 * - BullModule.forRoot: conexión Redis compartida para las colas BullMQ del
 *   pipeline IA (F4). La API solo PRODUCE jobs (`transcribe` al confirmar una
 *   subida); el worker los consume en su propio proceso.
 * - AuthModule (F1): endpoints /auth/* y los guards globales JWT + roles.
 * - VideosModule (F2): subida por presigned PUT y gestión del uploader.
 * - CatalogModule (F3): catálogo público (listado + detalle).
 * - StreamModule (F3): URL prefirmada de reproducción (Range → 206).
 * - SearchModule (F5): búsqueda pública por texto y semántica.
 */
@Module({
  imports: [
    PrismaModule,
    TerminusModule,
    BullModule.forRoot({ connection: redisConnection() }),
    AuthModule,
    VideosModule,
    CatalogModule,
    StreamModule,
    SearchModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
