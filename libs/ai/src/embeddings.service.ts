import { Injectable, Logger } from '@nestjs/common';

/** Dimensiones de bge-m3 — deben cuadrar con la columna vector(1024). */
export const EMBEDDING_DIMS = 1024;

/**
 * Cliente de embeddings sobre Ollama (F5, plan.md §5). El MISMO `bge-m3` embebe
 * documentos (worker, job `embed`) y queries (API, búsqueda semántica): usar el
 * mismo modelo en ambos lados es lo que hace comparable el coseno. Por eso vive
 * en una lib compartida y no duplicado en cada app.
 *
 * Multilingüe y 1024 dims → encaja con contenido en español y con vector(1024)
 * (plan.md §2). Costo $0: corre en el compose, sin API key.
 *
 * Lee process.env directamente (patrón de las otras libs): cada app consumidora
 * valida OLLAMA_URL/EMBED_MODEL en su propio schema al arrancar.
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private readonly baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
  private readonly model = process.env.EMBED_MODEL ?? 'bge-m3';
  private readonly timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 120000);

  /** Embebe un texto y devuelve el vector de 1024 dims. */
  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama embed respondió ${res.status}: ${body.slice(0, 300)}`);
    }

    // /api/embed devuelve { embeddings: number[][] } (un vector por input).
    const data = (await res.json()) as { embeddings?: number[][] };
    const vector = data.embeddings?.[0];
    if (!vector || vector.length !== EMBEDDING_DIMS) {
      throw new Error(
        `Embedding inesperado: se esperaban ${EMBEDDING_DIMS} dims, ` +
          `llegaron ${vector?.length ?? 0}`,
      );
    }
    return vector;
  }

  /**
   * Serializa un vector al literal que pgvector espera en SQL: `[0.1,0.2,...]`.
   * Lo usan worker (UPDATE embedding) y API (parámetro del operador `<=>`).
   */
  static toSqlVector(vector: number[]): string {
    return `[${vector.join(',')}]`;
  }
}
