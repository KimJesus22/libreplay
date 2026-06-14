import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@app/prisma';
import { EmbeddingsService } from '@app/ai';
import { SearchMode, SearchQueryDto } from './dto/search-query.dto';

/**
 * Umbral de DISTANCIA coseno para el modo semántico (operador `<=>`: 0 = idéntico,
 * 2 = opuesto). Recorta el ruido: sin tope, la query devolvería TODOS los videos
 * ordenados por cercanía, incluso los irrelevantes. 0.6 (≈ 40% de similitud)
 * deja pasar lo razonablemente parecido — calibrado con los videos demo (§10).
 */
const MAX_COSINE_DISTANCE = 0.6;

/**
 * Proyección pública de un resultado: las MISMAS columnas que expone el catálogo
 * (catalog.service `publicSelect`) — nunca `storageKey`, `embedding` ni
 * `searchVector`. Se listan explícitas en el SQL crudo de cada modo.
 */
export interface SearchRow {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  categories: string[];
  synopsis: string | null;
  tags: string[];
  views: number;
  publishedAt: Date | null;
  createdAt: Date;
}

/** Página de resultados (misma forma que el catálogo + el modo aplicado). */
export interface SearchResult {
  items: SearchRow[];
  total: number;
  page: number;
  pageSize: number;
  mode: SearchMode;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Despacha al modo pedido; ambos solo sobre videos PUBLISHED y paginados. */
  async search(query: SearchQueryDto): Promise<SearchResult> {
    const offset = (query.page - 1) * query.pageSize;
    const { items, total } =
      query.mode === SearchMode.SEMANTIC
        ? await this.semantic(query.q, query.pageSize, offset)
        : await this.text(query.q, query.pageSize, offset);

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      mode: query.mode,
    };
  }

  /**
   * Modo texto: full-text con tsvector (§6.3). `websearch_to_tsquery` entiende
   * sintaxis tipo buscador (comillas, OR, -exclusión); empareja contra la
   * columna GENERADA `searchVector` (índice GIN) y ordena por relevancia
   * (`ts_rank`). La query se interpola PARAMETRIZADA (no concatenada) → sin SQLi.
   */
  private async text(q: string, take: number, skip: number) {
    const tsquery = Prisma.sql`websearch_to_tsquery('spanish', ${q})`;
    const filter = Prisma.sql`status = 'PUBLISHED' AND "searchVector" @@ ${tsquery}`;

    const items = await this.prisma.$queryRaw<SearchRow[]>`
      SELECT id, "ownerId", title, description, categories, synopsis, tags,
             views, "publishedAt", "createdAt"
      FROM "Video"
      WHERE ${filter}
      ORDER BY ts_rank("searchVector", ${tsquery}) DESC, "publishedAt" DESC NULLS LAST
      LIMIT ${take} OFFSET ${skip}`;

    const total = await this.count(filter);
    return { items, total };
  }

  /**
   * Modo semántico: embebe la query con el MISMO bge-m3 que indexó los videos y
   * ordena por distancia coseno (`<=>`, índice HNSW), descartando lo que supere
   * el umbral. Solo videos con embedding (los que pasaron por el job `embed`).
   */
  private async semantic(q: string, take: number, skip: number) {
    const vector = EmbeddingsService.toSqlVector(await this.embeddings.embed(q));
    const distance = Prisma.sql`(embedding <=> ${vector}::vector)`;
    const filter = Prisma.sql`status = 'PUBLISHED' AND embedding IS NOT NULL AND ${distance} < ${MAX_COSINE_DISTANCE}`;

    const items = await this.prisma.$queryRaw<SearchRow[]>`
      SELECT id, "ownerId", title, description, categories, synopsis, tags,
             views, "publishedAt", "createdAt"
      FROM "Video"
      WHERE ${filter}
      ORDER BY ${distance} ASC
      LIMIT ${take} OFFSET ${skip}`;

    const total = await this.count(filter);
    return { items, total };
  }

  /** Total de coincidencias para la paginación (mismo WHERE que la página). */
  private async count(filter: Prisma.Sql): Promise<number> {
    const [{ count }] = await this.prisma.$queryRaw<[{ count: number }]>`
      SELECT count(*)::int AS count FROM "Video" WHERE ${filter}`;
    return count;
  }
}
