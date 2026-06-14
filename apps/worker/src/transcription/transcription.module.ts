import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { StorageModule } from '@app/storage';
import { TRANSCRIBE_QUEUE, METADATA_QUEUE } from '@app/queue';
import { TranscriptionProcessor } from './transcription.processor';
import { WhisperClient } from './whisper.client';

/**
 * Módulo del job `transcribe` (F4). Registra la cola `transcribe` para que el
 * @Processor cree el Worker BullMQ atado a ella, y la cola `metadata` (con sus
 * defaultJobOptions, porque aquí se ENCOLA el siguiente eslabón con @InjectQueue):
 * 3 reintentos con backoff exponencial, igual que el productor de transcribe en
 * la API — un fallo transitorio del LLM (Ollama saturado, un JSON que no validó)
 * no debe tumbar la metadata al primer intento (plan.md §5). PrismaModule es
 * global, pero StorageModule se importa explícito (baja el MP4).
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    BullModule.registerQueue(
      { name: TRANSCRIBE_QUEUE },
      {
        name: METADATA_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        },
      },
    ),
  ],
  providers: [TranscriptionProcessor, WhisperClient],
})
export class TranscriptionModule {}
