import { Injectable, NotFoundException } from '@nestjs/common';
import { VideoStatus } from '@prisma/client';
import { PrismaService } from '@app/prisma';
import { StorageService } from '@app/storage';

export interface StreamTarget {
  /** URL prefirmada de R2/MinIO; el `<video>` la usa como `src`. */
  url: string;
  expiresInS: number;
}

/** TTL de la URL de streaming (plan.md §3): cubre una reproducción completa. */
const STREAM_TTL_S = 7200;

@Injectable()
export class StreamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Emite la URL prefirmada para reproducir (HU-06, criterio §6.1). La API no
   * proxyea bytes: firma una URL GET y el navegador hace `Range` directo contra
   * el storage. Solo videos PUBLISHED — un video sin publicar no se reproduce
   * (404, indistinguible de inexistente: no se filtra qué hay sin publicar).
   *
   * Pedir la URL cuenta como una vista: es el momento en que arranca la
   * reproducción. Las peticiones `Range` siguientes van al storage, no aquí,
   * así que no inflan el contador — una reproducción ≈ una vista.
   */
  async getStreamUrl(id: string): Promise<StreamTarget> {
    const video = await this.prisma.video.findFirst({
      where: { id, status: VideoStatus.PUBLISHED },
      select: { storageKey: true },
    });
    if (!video) throw new NotFoundException('Video no encontrado');

    await this.prisma.video.update({
      where: { id },
      data: { views: { increment: 1 } },
    });

    return {
      url: await this.storage.presignedGetUrl(video.storageKey, STREAM_TTL_S),
      expiresInS: STREAM_TTL_S,
    };
  }
}
