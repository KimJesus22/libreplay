import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VideoStatus } from '@prisma/client';
import { PrismaService } from '@app/prisma';
import { CatalogQueryDto, CatalogSort } from './dto/catalog-query.dto';

/**
 * Proyección pública de un video: nunca expone `storageKey` (la clave interna
 * de R2/MinIO) ni `sizeBytes`. La reproducción no usa la clave — para eso está
 * GET /videos/:id/stream, que firma una URL temporal.
 */
const publicSelect = {
  id: true,
  ownerId: true,
  title: true,
  description: true,
  categories: true,
  views: true,
  publishedAt: true,
  createdAt: true,
} satisfies Prisma.VideoSelect;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Catálogo público (HU-05): SOLO videos PUBLISHED — los estados UPLOADING/
   * PROCESSING/READY son del flujo del uploader y HIDDEN es moderación (F6).
   * Filtro opcional por categoría y orden por novedades o popularidad.
   */
  async list(query: CatalogQueryDto) {
    const where: Prisma.VideoWhereInput = {
      status: VideoStatus.PUBLISHED,
      ...(query.category ? { categories: { has: query.category } } : {}),
    };

    const orderBy: Prisma.VideoOrderByWithRelationInput =
      query.sort === CatalogSort.POPULAR
        ? { views: 'desc' }
        : { publishedAt: 'desc' };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.video.findMany({
        where,
        orderBy,
        select: publicSelect,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.video.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** Detalle público: 404 si no existe o no está publicado. */
  async findOne(id: string) {
    const video = await this.prisma.video.findFirst({
      where: { id, status: VideoStatus.PUBLISHED },
      select: publicSelect,
    });
    if (!video) throw new NotFoundException('Video no encontrado');
    return video;
  }
}
