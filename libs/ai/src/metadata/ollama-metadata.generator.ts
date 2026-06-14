import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Category } from '@prisma/client';
import type { MetadataGenerator, MetadataInput } from './metadata-generator';
import { VideoMetadataSchema, type VideoMetadata } from './video-metadata.schema';

// Palabras clave del JSON Schema que Ollama NO soporta al convertirlo a
// gramática GBNF: con ellas presentes, el modelo deja de respetar el `enum` de
// categorías (devuelve "Historia"/"Política" fuera de la lista) e incluso
// objetos vacíos. Las quitamos para Ollama; la longitud/cardinalidad la sigue
// validando Zod de nuestro lado tras recibir la respuesta.
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  '$schema',
  'additionalProperties',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
]);

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
      out[key] = sanitizeSchema(child);
    }
    return out;
  }
  return value;
}

// JSON Schema derivado del schema Zod UNA vez (no por petición): es la salida
// estructurada que Ollama debe respetar (`format`). zod v4 lo genera (sin la
// dependencia zod-to-json-schema); lo saneamos para la gramática de Ollama.
const METADATA_JSON_SCHEMA = sanitizeSchema(z.toJSONSchema(VideoMetadataSchema));

// Lista de categorías para el prompt: el LLM debe elegir SOLO de aquí. El
// `format` ya lo fuerza, pero nombrarlas en el prompt mejora la elección.
const CATEGORY_LIST = Object.values(Category).join(', ');

/**
 * Adaptador por defecto del puerto MetadataGenerator: Ollama local (plan.md §5).
 *
 * Costo $0 absoluto — el LLM corre en el compose, sin API key ni cuota. Pide a
 * `qwen2.5:3b-instruct` una sinopsis + categorías + tags desde la transcripción,
 * con la salida forzada por JSON Schema y RE-validada con Zod (un 3B se equivoca).
 *
 * Lee process.env directamente: las libs no importan el schema de cada app
 * (sería dependencia invertida) — la app consumidora ya valida su entorno.
 */
@Injectable()
export class OllamaMetadataGenerator implements MetadataGenerator {
  private readonly logger = new Logger(OllamaMetadataGenerator.name);
  private readonly baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  private readonly model =
    process.env.METADATA_MODEL ?? 'qwen2.5:3b-instruct';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000);

  async generate(input: MetadataInput): Promise<VideoMetadata> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // AbortSignal corta si Ollama se cuelga; BullMQ reintenta el job.
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        stream: false,
        // format = JSON Schema: Ollama restringe la generación a esta forma.
        format: METADATA_JSON_SCHEMA,
        // temperatura baja: queremos consistencia, no creatividad.
        options: { temperature: 0.2 },
        messages: [
          {
            role: 'system',
            content:
              'Eres un catalogador de videos. Generas metadata en español a ' +
              'partir de la transcripción. Responde SOLO con el JSON pedido. ' +
              `Las categorías deben salir de esta lista fija: ${CATEGORY_LIST}.`,
          },
          {
            role: 'user',
            content:
              `Título del video: ${input.title}\n\n` +
              `Transcripción${input.language ? ` (${input.language})` : ''}:\n` +
              // Acotamos la transcripción: un prompt gigante satura el 3B y no
              // mejora la sinopsis. Los primeros ~6000 chars bastan para el gist.
              `${input.transcript.slice(0, 6000)}\n\n` +
              'Genera: una sinopsis breve (2-3 frases), de 1 a 3 categorías de ' +
              'la lista, y hasta 10 tags cortos.',
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama respondió ${res.status}: ${body.slice(0, 300)}`);
    }

    // Ollama devuelve { message: { content: '<json string>' } }.
    const data = (await res.json()) as { message?: { content?: string } };
    const raw = data.message?.content;
    if (!raw) {
      throw new Error('Ollama devolvió una respuesta sin contenido');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Ollama no devolvió JSON válido: ${raw.slice(0, 300)}`);
    }

    // Re-validación: aunque `format` lo guíe, un 3B puede colar una categoría
    // inventada o un campo de más. safeParse → error legible, nunca a la BD.
    const result = VideoMetadataSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Metadata del LLM no pasó la validación: ${result.error.message}`,
      );
    }

    this.logger.log(
      `Metadata generada: ${result.data.categories.join('/')} · ` +
        `${result.data.tags.length} tags · sinopsis ${result.data.synopsis.length} chars`,
    );
    return result.data;
  }
}
