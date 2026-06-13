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

// F5 añadirá METADATA_QUEUE ('metadata') y EMBED_QUEUE ('embed').
