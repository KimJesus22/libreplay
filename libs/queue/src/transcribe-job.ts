/**
 * Payload del job `transcribe`.
 *
 * Solo el `videoId`: el job NO viaja con la metadata del video ni la storageKey.
 * El worker recarga el registro fresco desde la BD al procesar — así un job que
 * espera en la cola minutos (o que se reintenta tras un fallo) siempre opera
 * sobre el estado actual del video, no sobre una foto vieja serializada en Redis.
 */
export interface TranscribeJobData {
  videoId: string;
}

// Nombre del job dentro de la cola (BullMQ separa cola y nombre de job). Una
// sola clase de job por ahora; tenerlo nombrado deja sitio a futuros tipos.
export const TRANSCRIBE_JOB = 'transcribe';
