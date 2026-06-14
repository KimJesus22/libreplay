import type { VideoMetadata } from './video-metadata.schema';

/** Lo que el pipeline le da al generador para producir la metadata. */
export interface MetadataInput {
  title: string;
  transcript: string;
  /** Idioma detectado por whisper (ISO 639-1); orienta el prompt del LLM. */
  language?: string;
}

/**
 * Puerto hexagonal de generación de metadata (plan.md §5).
 *
 * La estrategia de costo $0 (Ollama local) es el adaptador por defecto, pero el
 * pipeline depende de ESTA interfaz, no de Ollama: enchufar un adaptador Claude
 * (`@anthropic-ai/sdk`) el día que haya presupuesto es cambiar el provider en
 * AiModule, sin tocar el processor. Buen punto de diseño y de entrevista.
 */
export interface MetadataGenerator {
  generate(input: MetadataInput): Promise<VideoMetadata>;
}

/** Token de DI del puerto (las interfaces no existen en runtime). */
export const METADATA_GENERATOR = Symbol('METADATA_GENERATOR');
