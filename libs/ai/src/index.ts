export { AiModule } from './ai.module';
export { EmbeddingsService, EMBEDDING_DIMS } from './embeddings.service';
export {
  METADATA_GENERATOR,
  type MetadataGenerator,
  type MetadataInput,
} from './metadata/metadata-generator';
export {
  VideoMetadataSchema,
  type VideoMetadata,
} from './metadata/video-metadata.schema';
export { OllamaMetadataGenerator } from './metadata/ollama-metadata.generator';
