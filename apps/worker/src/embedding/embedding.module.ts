import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { AiModule } from '@app/ai';
import { EMBED_QUEUE } from '@app/queue';
import { EmbeddingProcessor } from './embedding.processor';

/**
 * Módulo del job `embed` (F5), etapa terminal del pipeline. Registra la cola
 * `embed` para que el @Processor cree su Worker; AiModule aporta EmbeddingsService
 * (bge-m3). No encola nada después: al terminar, el video queda READY.
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    BullModule.registerQueue({ name: EMBED_QUEUE }),
  ],
  providers: [EmbeddingProcessor],
})
export class EmbeddingModule {}
