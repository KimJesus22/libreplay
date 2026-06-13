import { ApiPropertyOptional } from '@nestjs/swagger';
import { Category } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Orden del catálogo (HU-05): novedades o lo más visto. */
export enum CatalogSort {
  RECENT = 'recent',
  POPULAR = 'popular',
}

/**
 * Query de GET /videos (HU-05). Todo opcional con defaults sanos: sin
 * parámetros devuelve la primera página por novedades. La paginación es
 * obligatoria por diseño — un catálogo sin tope haría un SELECT sin LIMIT que
 * crece con la tabla.
 */
export class CatalogQueryDto {
  @ApiPropertyOptional({ enum: Category, description: 'Filtra por categoría' })
  @IsOptional()
  @IsEnum(Category)
  category?: Category;

  @ApiPropertyOptional({ enum: CatalogSort, default: CatalogSort.RECENT })
  @IsOptional()
  @IsEnum(CatalogSort)
  sort: CatalogSort = CatalogSort.RECENT;

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
