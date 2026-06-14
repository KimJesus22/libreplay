import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { StorageModule } from '@app/storage';
import { TRANSCRIBE_QUEUE, METADATA_QUEUE } from '@app/queue';
import { TranscriptionProcessor } from './transcription.processor';
import { WhisperClient } from './whisper.client';

/**
 * Módulo del job `transcribe` (F4). Registra la cola `transcribe` para que el
 * @Processor cree el Worker BullMQ atado a ella, y la cola `metadata` para
 * poder ENCOLAR el siguiente eslabón con @InjectQueue (F5). Ninguna lleva
 * defaultJobOptions aquí: el productor real (la API, que arranca el pipeline)
 * ya las fija; el worker re-encola con las mismas opciones por defecto de BullMQ.
 * PrismaModule es global, pero StorageModule se importa explícito (baja el MP4).
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    BullModule.registerQueue(
      { name: TRANSCRIBE_QUEUE },
      { name: METADATA_QUEUE },
    ),
  ],
  providers: [TranscriptionProcessor, WhisperClient],
})
export class TranscriptionModule {}
