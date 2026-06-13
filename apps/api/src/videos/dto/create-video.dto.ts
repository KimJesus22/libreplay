import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Body de POST /videos. El cliente declara qué va a subir ANTES de subirlo:
 * con título, nombre y tamaño la API valida (MP4, ≤ límite — plan.md §8) y
 * firma una URL atada a ese tamaño exacto. Los bytes nunca pasan por aquí.
 */
export class CreateVideoDto {
  @ApiProperty({ example: 'Mi primer corto', maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ example: 'Grabado con el celular', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ example: 'corto.mp4' })
  @IsString()
  // Validación de extensión (plan.md §8). El MIME no se le pide al cliente:
  // la API lo impone — la URL se firma con Content-Type video/mp4 y el
  // storage rechaza cualquier otro valor.
  @Matches(/\.mp4$/i, { message: 'fileName debe terminar en .mp4' })
  fileName!: string;

  @ApiProperty({ example: 10485760, description: 'Tamaño exacto en bytes' })
  @IsInt()
  @IsPositive()
  sizeBytes!: number;
}

export class UpdateVideoDto {
  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}
