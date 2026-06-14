import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { AiModule } from '@app/ai';
import { METADATA_QUEUE, EMBED_QUEUE } from '@app/queue';
import { MetadataProcessor } from './metadata.processor';

/**
 * Módulo del job `metadata` (F5). Registra `metadata` (para que el @Processor
 * cree su Worker) y `embed` con sus defaultJobOptions (aquí se ENCOLA embed con
 * @InjectQueue): 3 reintentos con backoff, como el resto del pipeline — el
 * embedding también puede fallar de forma transitoria (Ollama saturado).
 * AiModule aporta el puerto MetadataGenerator (Ollama por defecto).
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    BullModule.registerQueue(
      { name: METADATA_QUEUE },
      {
        name: EMBED_QUEUE,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        },
      },
    ),
  ],
  providers: [MetadataProcessor],
})
export class MetadataModule {}
