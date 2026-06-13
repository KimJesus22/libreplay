import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { StreamService } from './stream.service';

/**
 * Streaming (F3, HU-06). A diferencia del catálogo (público), reproducir exige
 * sesión: cualquier usuario autenticado sirve (spec §4 — "usuarios
 * autenticados pueden reproducir"), así que NO lleva `@Roles` (eso lo limitaría
 * a uploaders) ni `@Public` (eso lo abriría a anónimos). El guard global JWT
 * exige el token; RolesGuard sin metadata deja pasar a cualquier rol.
 */
@ApiTags('stream')
@ApiBearerAuth()
@Controller('videos')
export class StreamController {
  constructor(private readonly stream: StreamService) {}

  @Get(':id/stream')
  @ApiOperation({ summary: 'URL prefirmada para reproducir (cuenta una vista)' })
  @ApiResponse({ status: 404, description: 'No existe o no está publicado' })
  getStreamUrl(@Param('id', ParseUUIDPipe) id: string) {
    return this.stream.getStreamUrl(id);
  }
}
