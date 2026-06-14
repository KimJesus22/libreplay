/**
 * Payload del job `metadata` (F5, plan.md §5).
 *
 * Solo el `videoId`, por el mismo motivo que `transcribe`: el worker recarga el
 * video y su Transcript frescos al procesar, nunca opera sobre una foto vieja
 * serializada en Redis. Lo encola el processor de transcripción tras guardar el
 * Transcript.
 */
export interface MetadataJobData {
  videoId: string;
}

export const METADATA_JOB = 'metadata';
