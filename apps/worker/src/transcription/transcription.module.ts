import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { StorageModule } from '@app/storage';
import { TRANSCRIBE_QUEUE } from '@app/queue';
import { TranscriptionProcessor } from './transcription.processor';
import { WhisperClient } from './whisper.client';

/**
 * Módulo del job `transcribe` (F4). Registra la cola en el lado CONSUMIDOR
 * (sin defaultJobOptions: eso es cosa del productor en la API) para que el
 * @Processor cree el Worker BullMQ atado a ella. PrismaModule es global, pero
 * StorageModule se importa explícito porque el processor baja el MP4.
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    BullModule.registerQueue({ name: TRANSCRIBE_QUEUE }),
  ],
  providers: [TranscriptionProcessor, WhisperClient],
})
export class TranscriptionModule {}
