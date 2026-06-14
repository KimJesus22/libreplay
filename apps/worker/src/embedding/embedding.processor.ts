import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '@app/prisma';
import { EmbeddingsService } from '@app/ai';
import { EMBED_QUEUE, type EmbedJobData } from '@app/queue';
import { VideoStatus } from '@prisma/client';

/**
 * Último eslabón del pipeline IA (plan.md §5): embebe el video para la búsqueda
 * semántica y lo deja READY.
 *
 * Embebe sinopsis + transcripción (no solo el título — plan.md §10: maximiza la
 * señal) con bge-m3 y guarda el vector en pgvector vía SQL crudo (Prisma no tipa
 * `vector`). Es la etapa TERMINAL: al terminar (con o sin embedding) el video
 * pasa a READY y queda listo para que el uploader revise y publique (HU-04).
 */
@Processor(EMBED_QUEUE)
export class EmbeddingProcessor extends WorkerHost {
  private readonly logger = new Logger(EmbeddingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {
    super();
  }

  async process(job: Job<EmbedJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Embebiendo ${videoId} (intento ${job.attemptsMade + 1})`);

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { transcript: true },
    });
    if (!video) {
      this.logger.warn(`Video ${videoId} ya no existe; se descarta el job`);
      return;
    }

    // Texto a embeber: sinopsis (si el LLM la generó) + transcripción. filter
    // descarta los nulos; si no queda nada (pipeline degradado del todo), no
    // hay qué embeber: dejamos el video READY sin vector y salimos.
    const text = [video.synopsis, video.transcript?.text]
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (!text) {
      this.logger.warn(`Video ${videoId} sin texto que embeber; pasa a READY sin vector`);
      await this.markReady(videoId);
      return;
    }

    const vector = await this.embeddings.embed(text);
    // SQL crudo: Prisma no tipa `vector`. El literal `[..]` se castea a vector.
    await this.prisma.$executeRaw`
      UPDATE "Video" SET embedding = ${EmbeddingsService.toSqlVector(vector)}::vector
      WHERE id = ${videoId}`;

    await this.markReady(videoId);
    this.logger.log(`Video ${videoId} embebido → READY`);
  }

  private async markReady(videoId: string): Promise<void> {
    await this.prisma.video.update({
      where: { id: videoId },
      data: { status: VideoStatus.READY },
    });
  }

  /**
   * Reintentos agotados (spec §6.2): el embedding no salió, pero el video debe
   * llegar a READY igual (publicable; la búsqueda semántica simplemente no lo
   * encontrará, la textual sí). En fallos intermedios no tocamos nada.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<EmbedJobData>, err: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Fallo embed de ${job.data.videoId} (intento ${job.attemptsMade}/${attempts}): ${err.message} — se reintentará`,
      );
      return;
    }

    this.logger.error(
      `Embed de ${job.data.videoId} agotó ${attempts} intentos: ${err.message}. ` +
        'El video pasa a READY sin embedding (publicable, spec §6.2).',
    );
    await this.prisma.video
      .update({ where: { id: job.data.videoId }, data: { status: VideoStatus.READY } })
      .catch(() => undefined);
  }
}
