/**
 * Nombres de las colas BullMQ del pipeline IA (plan.md §5).
 *
 * Viven en una constante compartida (no un string literal repetido) porque la
 * API es el PRODUCTOR (`@InjectQueue`) y el worker el CONSUMIDOR (`@Processor`):
 * si los dos procesos no usan exactamente el mismo nombre, el job se encola en
 * una cola que nadie consume y la transcripción nunca ocurre, sin error visible.
 */

// F4: extracción de audio + faster-whisper.
export const TRANSCRIBE_QUEUE = 'transcribe';

// F5: segundo y tercer eslabón del pipeline (plan.md §5). El worker encadena
// transcribe → metadata → embed; cada etapa es una cola propia con reintentos
// y fallo aislado. Mismos nombres compartidos productor↔consumidor.
export const METADATA_QUEUE = 'metadata'; // Ollama LLM: sinopsis + categorías + tags.
export const EMBED_QUEUE = 'embed'; // Ollama bge-m3: vector → pgvector.
