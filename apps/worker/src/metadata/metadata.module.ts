import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '@app/prisma';
import { AiModule } from '@app/ai';
import { METADATA_QUEUE, EMBED_QUEUE } from '@app/queue';
import { MetadataProcessor } from './metadata.processor';

/**
 * Módulo del job `metadata` (F5). Registra `metadata` (para que el @Processor
 * cree su Worker) y `embed` (para encolar el siguiente eslabón con @InjectQueue).
 * AiModule aporta el puerto MetadataGenerator (Ollama por defecto).
 */
@Module({
  imports: [
    PrismaModule,
    AiModule,
    BullModule.registerQueue({ name: METADATA_QUEUE }, { name: EMBED_QUEUE }),
  ],
  providers: [MetadataProcessor],
})
export class MetadataModule {}
