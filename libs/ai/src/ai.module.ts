import { Module } from '@nestjs/common';
import { EmbeddingsService } from './embeddings.service';
import { METADATA_GENERATOR } from './metadata/metadata-generator';
import { OllamaMetadataGenerator } from './metadata/ollama-metadata.generator';

/**
 * Clientes de IA compartidos (F5, plan.md §5). Mismo patrón que StorageModule:
 * no es @Global, se importa explícito donde se usa.
 *
 * - EmbeddingsService (bge-m3): lo usan worker (job `embed`) y API (query de
 *   búsqueda semántica).
 * - METADATA_GENERATOR → OllamaMetadataGenerator: solo el worker (job `metadata`).
 *   Se inyecta por el TOKEN, no por la clase, para que cambiar a un adaptador
 *   Claude sea reemplazar este `useClass` sin tocar el processor (plan.md §5).
 */
@Module({
  providers: [
    EmbeddingsService,
    { provide: METADATA_GENERATOR, useClass: OllamaMetadataGenerator },
  ],
  exports: [EmbeddingsService, METADATA_GENERATOR],
})
export class AiModule {}
