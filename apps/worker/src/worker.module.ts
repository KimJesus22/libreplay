import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { redisConnection } from '@app/queue';
import { TranscriptionModule } from './transcription/transcription.module';

/**
 * Módulo raíz del worker — el segundo proceso Node del plan (plan.md §1).
 *
 * Separar API y worker en procesos distintos es una decisión load-bearing:
 * si el pipeline IA satura CPU o se cae, la API sigue sirviendo video.
 * La IA es mejora, no bloqueo (spec §6.2).
 *
 * - BullModule.forRoot: misma conexión Redis que la API; el worker CONSUME.
 * - TranscriptionModule (F4): job `transcribe` (audio → faster-whisper).
 *   MetadataModule y EmbeddingModule se sumarán en F5.
 */
@Module({
  imports: [
    PrismaModule,
    BullModule.forRoot({ connection: redisConnection() }),
    TranscriptionModule,
  ],
})
export class WorkerModule {}
