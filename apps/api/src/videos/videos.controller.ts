import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedRequest } from '../auth/token-payload';
import { CreateVideoDto, UpdateVideoDto } from './dto/create-video.dto';
import { VideosService } from './videos.service';

/**
 * Gestión de videos del uploader (F2, HU-03). Todo el controller exige rol
 * UPLOADER o ADMIN (criterio §6.4: viewer → 403); el guard global ya garantiza
 * el 401 sin token. El catálogo público (GET /videos) llega en F3 como módulo
 * aparte — leer es de todos, escribir es de uploaders.
 */
@ApiTags('videos')
@ApiBearerAuth()
@Roles(Role.UPLOADER, Role.ADMIN)
@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post()
  @ApiOperation({ summary: 'Iniciar subida: registra el video y firma URL PUT' })
  @ApiResponse({ status: 400, description: 'No es MP4 o excede el límite' })
  @ApiResponse({ status: 403, description: 'Rol viewer (§6.4)' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateVideoDto) {
    // req.user existe siempre: el guard global rechazó antes a los anónimos.
    return this.videos.createUpload(req.user!.sub, dto);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar que el PUT terminó (verifica el objeto)' })
  @ApiResponse({ status: 409, description: 'Objeto ausente o ya confirmado' })
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.confirmUpload(id, req.user!.sub);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar título/descripción de un video propio' })
  @ApiResponse({ status: 403, description: 'El video es de otro usuario' })
  update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videos.update(id, req.user!.sub, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un video propio (storage + registro)' })
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.videos.remove(id, req.user!.sub);
  }
}
