import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Video, VideoStatus } from '@prisma/client';
import { PrismaService } from '@app/prisma';
import { StorageService } from '@app/storage';
import { randomUUID } from 'node:crypto';
import { validateEnv } from '../config/env';
import { CreateVideoDto, UpdateVideoDto } from './dto/create-video.dto';

export interface CreatedUpload {
  video: Video;
  upload: {
    url: string;
    method: 'PUT';
    /** El cliente DEBE mandar estos headers: están dentro de la firma. */
    headers: { 'Content-Type': string };
    expiresInS: number;
  };
}

const VIDEO_CONTENT_TYPE = 'video/mp4';

@Injectable()
export class VideosService {
  // bytes; configurable por env (plan.md §8) — default 500 MB.
  private readonly maxSizeBytes =
    validateEnv().MAX_VIDEO_SIZE_MB * 1024 * 1024;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Flujo de subida (HU-03): crear el registro en estado UPLOADING y firmar
   * una URL PUT atada a tamaño y MIME exactos. El registro nace ANTES de la
   * subida para que /confirm tenga contra qué cotejar.
   */
  async createUpload(ownerId: string, dto: CreateVideoDto): Promise<CreatedUpload> {
    if (dto.sizeBytes > this.maxSizeBytes) {
      throw new BadRequestException(
        `El video excede el límite de ${this.maxSizeBytes / 1024 / 1024} MB`,
      );
    }

    // El id se genera aquí (no con el default de Prisma) porque la clave de
    // storage lo incluye y ambos se escriben en el mismo create. Clave =
    // `videos/<uuid>.mp4`: nunca el fileName del usuario — un nombre como
    // `../otro.mp4` o con caracteres raros no debe poder tocar la clave.
    const id = randomUUID();
    const storageKey = `videos/${id}.mp4`;

    const video = await this.prisma.video.create({
      data: {
        id,
        ownerId,
        title: dto.title,
        description: dto.description,
        storageKey,
        sizeBytes: dto.sizeBytes,
      },
    });

    return {
      video,
      upload: {
        url: await this.storage.presignedPutUrl(
          storageKey,
          VIDEO_CONTENT_TYPE,
          dto.sizeBytes,
        ),
        method: 'PUT',
        headers: { 'Content-Type': VIDEO_CONTENT_TYPE },
        expiresInS: 3600,
      },
    };
  }

  /**
   * El cliente avisa que terminó el PUT. La API verifica contra el storage
   * (HeadObject) — confiar en el "ya subí" del cliente dejaría registros
   * READY sin bytes detrás. Tamaño real ≠ declarado → se borra el objeto:
   * la firma ya lo impide, pero R2/MinIO pueden diferir en qué tan estrictos
   * son y la regla del límite es de la API, no del storage.
   */
  async confirmUpload(id: string, userId: string): Promise<Video> {
    const video = await this.getOwned(id, userId);
    if (video.status !== VideoStatus.UPLOADING) {
      throw new ConflictException('Esta subida ya fue confirmada');
    }

    const stored = await this.storage.headObject(video.storageKey);
    if (!stored) {
      throw new ConflictException(
        'El archivo aún no llegó al storage — ¿terminó el PUT?',
      );
    }
    if (stored.sizeBytes !== video.sizeBytes) {
      await this.storage.deleteObject(video.storageKey);
      await this.prisma.video.update({
        where: { id },
        data: { status: VideoStatus.FAILED },
      });
      throw new BadRequestException(
        'El tamaño subido no coincide con el declarado; la subida se descartó',
      );
    }

    // DEUDA (F4): aquí se encolará el job `transcribe` y el estado pasará a
    // PROCESSING. Sin pipeline todavía, READY es el estado honesto.
    return this.prisma.video.update({
      where: { id },
      data: { status: VideoStatus.READY },
    });
  }

  async update(id: string, userId: string, dto: UpdateVideoDto): Promise<Video> {
    await this.getOwned(id, userId);
    return this.prisma.video.update({ where: { id }, data: dto });
  }

  /** Borra objeto + registro. Solo el dueño (HU-03); admin llega en F6. */
  async remove(id: string, userId: string): Promise<void> {
    const video = await this.getOwned(id, userId);
    // Primero el storage: si falla, el registro sigue apuntando al objeto y
    // se puede reintentar. Al revés quedaría un objeto huérfano pagando
    // espacio sin que nada lo referencie.
    await this.storage.deleteObject(video.storageKey);
    await this.prisma.video.delete({ where: { id } });
  }

  /** 404 si no existe, 403 si existe pero es de otro usuario. */
  private async getOwned(id: string, userId: string): Promise<Video> {
    const video = await this.prisma.video.findUnique({ where: { id } });
    if (!video) throw new NotFoundException('Video no encontrado');
    if (video.ownerId !== userId) {
      throw new ForbiddenException('Este video no es tuyo');
    }
    return video;
  }
}
