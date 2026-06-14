import { Inject, Logger } from '@nestjs/common';
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '@app/prisma';
import {
  METADATA_QUEUE,
  EMBED_QUEUE,
  EMBED_JOB,
  type MetadataJobData,
  type EmbedJobData,
} from '@app/queue';
import {
  METADATA_GENERATOR,
  type MetadataGenerator,
} from '@app/ai';

/**
 * Segundo eslabón del pipeline IA (plan.md §5): genera la metadata sugerida.
 *
 * Lee el Transcript que dejó la transcripción, le pide al LLM (puerto
 * MetadataGenerator → Ollama) sinopsis + categorías + tags, los guarda como
 * SUGERENCIA (el uploader revisa antes de publicar, HU-04) y encola `embed`.
 *
 * Fallo aislado (spec §6.2): si agota reintentos, igual encola `embed` para que
 * la búsqueda funcione sobre la transcripción — la metadata es mejora, no bloqueo.
 */
@Processor(METADATA_QUEUE)
export class MetadataProcessor extends WorkerHost {
  private readonly logger = new Logger(MetadataProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(METADATA_GENERATOR)
    private readonly generator: MetadataGenerator,
    @InjectQueue(EMBED_QUEUE)
    private readonly embedQueue: Queue<EmbedJobData>,
  ) {
    super();
  }

  async process(job: Job<MetadataJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Generando metadata de ${videoId} (intento ${job.attemptsMade + 1})`);

    const video = await this.prisma.video.findUnique({
      where: { id: videoId },
      include: { transcript: true },
    });
    if (!video) {
      this.logger.warn(`Video ${videoId} ya no existe; se descarta el job`);
      return;
    }

    // Sin transcripción no hay de qué sacar metadata (un fallo total de la etapa
    // anterior). No es un error de esta etapa: saltamos al embed (que degradará
    // a solo-READY) para que el video igual termine el pipeline.
    if (!video.transcript) {
      this.logger.warn(`Video ${videoId} sin transcript; salto metadata → embed`);
      await this.embedQueue.add(EMBED_JOB, { videoId });
      return;
    }

    const meta = await this.generator.generate({
      title: video.title,
      transcript: video.transcript.text,
      language: video.transcript.language,
    });

    await this.prisma.video.update({
      where: { id: videoId },
      data: {
        synopsis: meta.synopsis,
        categories: meta.categories,
        tags: meta.tags,
      },
    });

    // Encola el último eslabón. El video sigue PROCESSING hasta que embed lo
    // deje READY.
    await this.embedQueue.add(EMBED_JOB, { videoId });
    this.logger.log(`Metadata de ${videoId} guardada → encolado embed`);
  }

  /**
   * Reintentos agotados (spec §6.2): la metadata no salió, pero el pipeline NO
   * debe detenerse. Encolamos `embed` igual — la búsqueda funcionará sobre la
   * transcripción y el video llegará a READY. En fallos intermedios no tocamos
   * nada: BullMQ reintenta.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<MetadataJobData>, err: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Fallo metadata de ${job.data.videoId} (intento ${job.attemptsMade}/${attempts}): ${err.message} — se reintentará`,
      );
      return;
    }

    this.logger.error(
      `Metadata de ${job.data.videoId} agotó ${attempts} intentos: ${err.message}. ` +
        'Se encola embed igual (degradación: búsqueda sobre la transcripción).',
    );
    await this.embedQueue
      .add(EMBED_JOB, { videoId: job.data.videoId })
      .catch(() => undefined);
  }
}
