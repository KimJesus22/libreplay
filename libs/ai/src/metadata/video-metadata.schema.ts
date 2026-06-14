import { z } from 'zod';
import { Category } from '@prisma/client';

/**
 * Forma de la metadata que el LLM debe devolver (F5, plan.md §5).
 *
 * Es la fuente de verdad doble: (1) se convierte a JSON Schema con
 * `z.toJSONSchema()` y se pasa como `format` a Ollama para FORZAR la salida
 * estructurada (no texto libre que haya que parsear con regex); (2) re-valida
 * la respuesta — un modelo de 3B puede inventarse un campo o una categoría
 * fuera del enum, y eso no debe llegar nunca a la BD.
 */
export const VideoMetadataSchema = z.object({
  // Sinopsis breve para el catálogo; tope para que el LLM no divague.
  synopsis: z.string().min(1).max(2000),
  // Categorías del enum CERRADO (plan.md §10): el LLM elige de la lista fija,
  // nunca texto libre. 1–3 para que no etiquete todo con todo.
  categories: z.array(z.nativeEnum(Category)).min(1).max(3),
  // Tags libres (a diferencia de categories): palabras clave cortas. Tope para
  // acotar el ruido; pueden ir vacíos si el LLM no encuentra ninguno claro.
  tags: z.array(z.string().min(1).max(40)).max(10),
});

export type VideoMetadata = z.infer<typeof VideoMetadataSchema>;
