import { Logger } from '@nestjs/common';
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
  InjectQueue,
} from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '@app/prisma';
import { StorageService } from '@app/storage';
import {
  TRANSCRIBE_QUEUE,
  METADATA_QUEUE,
  METADATA_JOB,
  type TranscribeJobData,
  type MetadataJobData,
} from '@app/queue';
import { VideoStatus } from '@prisma/client';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { extractAudio } from './ffmpeg';
import { WhisperClient } from './whisper.client';

/**
 * Primer eslabón del pipeline IA (plan.md §5): transcribe el audio de un video.
 *
 * Flujo: baja el MP4 del storage → ffmpeg extrae el audio → whisper transcribe →
 * guarda el Transcript y ENCOLA el siguiente eslabón (`metadata`); el video sigue
 * PROCESSING hasta que `embed` (la etapa terminal) lo deje READY. Los reintentos
 * (3, backoff exponencial) los configura el PRODUCTOR en la cola; aquí solo se
 * lanza la excepción y BullMQ reintenta. Si se agotan, `onFailed` deja el video
 * READY igualmente (sin metadata ni embedding): la IA es mejora, no bloqueo (spec §6.2).
 */
@Processor(TRANSCRIBE_QUEUE)
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly whisper: WhisperClient,
    // Segundo eslabón del pipeline: tras transcribir, este processor ENCOLA el
    // job `metadata`. El worker es productor además de consumidor (plan.md §5).
    @InjectQueue(METADATA_QUEUE)
    private readonly metadataQueue: Queue<MetadataJobData>,
  ) {
    super();
  }

  async process(job: Job<TranscribeJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Transcribiendo video ${videoId} (intento ${job.attemptsMade + 1})`);

    // Se recarga el video fresco (el job solo trae el id): un fallo previo o un
    // borrado pudieron cambiarlo. Si ya no existe, el job no tiene nada que hacer.
    const video = await this.prisma.video.findUnique({ where: { id: videoId } });
    if (!video) {
      this.logger.warn(`Video ${videoId} ya no existe; se descarta el job`);
      return;
    }

    // Directorio temporal aislado por job: dos transcripciones en paralelo no se
    // pisan los archivos, y se borra entero al final pase lo que pase.
    const workDir = await mkdtemp(join(tmpdir(), `transcribe-${videoId}-`));
    const videoPath = join(workDir, 'input.mp4');
    const audioPath = join(workDir, 'audio.wav');

    try {
      await this.storage.downloadToFile(video.storageKey, videoPath);
      await extractAudio(videoPath, audioPath);
      const result = await this.whisper.transcribe(audioPath);

      // upsert (no create): un reintento que llega tras un guardado parcial no
      // debe chocar con una fila existente. videoId es la PK del Transcript.
      await this.prisma.transcript.upsert({
        where: { videoId },
        create: { videoId, text: result.text, language: result.language },
        update: { text: result.text, language: result.language },
      });

      // Guarda la duración pero NO pasa a READY: el video sigue PROCESSING
      // mientras corren metadata y embed. Solo `embed` (etapa terminal) o un
      // fallo total lo dejan READY.
      await this.prisma.video.update({
        where: { id: videoId },
        data: { durationS: Math.round(result.durationS) },
      });

      // Encola el siguiente eslabón. Si esto lanza (Redis caído), el job de
      // transcripción se marca fallido y BullMQ reintenta — el Transcript ya
      // está guardado, así que el reintento es barato (upsert idempotente).
      await this.metadataQueue.add(METADATA_JOB, { videoId });

      this.logger.log(`Video ${videoId} transcrito → encolado metadata`);
    } finally {
      // Limpieza siempre: un proceso de larga vida no puede ir dejando MP4s y
      // WAVs en /tmp. `force` no falla si el dir ya no está.
      await rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * Se dispara en cada fallo. Solo actuamos cuando se AGOTARON los reintentos
   * (attemptsMade alcanza attempts): ahí el pipeline falló del todo y dejamos el
   * video READY con campos IA vacíos para que sea publicable a mano (spec §6.2).
   * En fallos intermedios no tocamos nada: BullMQ va a reintentar.
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job<TranscribeJobData>, err: Error): Promise<void> {
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) {
      this.logger.warn(
        `Fallo transcribiendo ${job.data.videoId} (intento ${job.attemptsMade}/${attempts}): ${err.message} — se reintentará`,
      );
      return;
    }

    this.logger.error(
      `Transcripción de ${job.data.videoId} agotó ${attempts} intentos: ${err.message}. ` +
        'El video pasa a READY sin transcripción (publicable a mano, spec §6.2).',
    );
    // El video pudo haberse borrado entre medias; update con catch silencioso.
    await this.prisma.video
      .update({
        where: { id: job.data.videoId },
        data: { status: VideoStatus.READY },
      })
      .catch(() => undefined);
  }
}
