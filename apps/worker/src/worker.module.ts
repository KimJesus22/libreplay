import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { redisConnection } from '@app/queue';
import { TranscriptionModule } from './transcription/transcription.module';
import { MetadataModule } from './metadata/metadata.module';
import { EmbeddingModule } from './embedding/embedding.module';

/**
 * Módulo raíz del worker — el segundo proceso Node del plan (plan.md §1).
 *
 * Separar API y worker en procesos distintos es una decisión load-bearing:
 * si el pipeline IA satura CPU o se cae, la API sigue sirviendo video.
 * La IA es mejora, no bloqueo (spec §6.2).
 *
 * - BullModule.forRoot: misma conexión Redis que la API; el worker CONSUME.
 * - Pipeline IA encadenado (plan.md §5): transcribe → metadata → embed. Cada
 *   etapa es su módulo con su @Processor; cada una encola la siguiente.
 */
@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({ connection: redisConnection() }),
    TranscriptionModule,
    MetadataModule,
    EmbeddingModule,
  ],
})
export class WorkerModule {}
