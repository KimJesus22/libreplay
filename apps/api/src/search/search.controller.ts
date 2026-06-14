import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

/**
 * Búsqueda pública (F5, HU-07, §6.3). `@Public()` como el catálogo: buscar no
 * requiere cuenta. Un solo endpoint con `mode=text|semantic`.
 */
@ApiTags('search')
@Public()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Buscar videos publicados por texto (tsvector) o significado (semántico)',
  })
  list(@Query() query: SearchQueryDto) {
    return this.search.search(query);
  }
}
