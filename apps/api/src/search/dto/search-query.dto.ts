import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/**
 * Modo de búsqueda (HU-07, §6.3):
 * - `text`: full-text por palabras (tsvector) — coincidencias literales.
 * - `semantic`: por significado (embedding + coseno) — encuentra un video aunque
 *   la query no comparta ninguna palabra con su título/sinopsis.
 */
export enum SearchMode {
  TEXT = 'text',
  SEMANTIC = 'semantic',
}

/**
 * Query de GET /search (HU-07). `q` es obligatoria; el resto opcional con
 * defaults, igual que el catálogo. Paginación obligatoria por diseño (sin tope
 * el SELECT crece con la tabla).
 */
export class SearchQueryDto {
  @ApiProperty({ example: 'robot que aprende a sentir', minLength: 2 })
  @IsString()
  @MinLength(2)
  q!: string;

  @ApiPropertyOptional({ enum: SearchMode, default: SearchMode.TEXT })
  @IsOptional()
  @IsEnum(SearchMode)
  mode: SearchMode = SearchMode.TEXT;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 24;
}
