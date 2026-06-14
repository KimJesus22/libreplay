/**
 * Payload del job `embed` (F5, plan.md §5).
 *
 * Última etapa del pipeline: embebe sinopsis+transcript con bge-m3 y deja el
 * video en READY. Solo el `videoId` (ver metadata-job.ts). Lo encola el
 * processor de metadata tras guardar las sugerencias del LLM.
 */
export interface EmbedJobData {
  videoId: string;
}

export const EMBED_JOB = 'embed';
