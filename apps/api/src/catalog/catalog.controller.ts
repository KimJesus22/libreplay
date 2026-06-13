import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

/**
 * Catálogo público (F3, HU-05): cualquier visitante explora y ve detalle sin
 * cuenta (spec §4). Por eso `@Public()` — el guard global JWT cierra todo por
 * defecto. Vive aparte de VideosController (gestión del uploader) aunque
 * compartan el prefijo `/videos`: leer es de todos, escribir es de uploaders.
 */
@ApiTags('catalog')
@Public()
@Controller('videos')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo público: filtra por categoría y ordena' })
  list(@Query() query: CatalogQueryDto) {
    return this.catalog.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle público de un video publicado' })
  @ApiResponse({ status: 404, description: 'No existe o no está publicado' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.findOne(id);
  }
}
