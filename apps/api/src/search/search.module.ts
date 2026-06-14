import { Module } from '@nestjs/common';
import { AiModule } from '@app/ai';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Módulo de búsqueda (F5). Importa AiModule por EmbeddingsService: el modo
 * semántico embebe la query del usuario con el mismo bge-m3 que indexó los
 * videos. PrismaModule es global (el SQL crudo de tsvector/pgvector vive aquí).
 */
@Module({
  imports: [AiModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
