import { Injectable, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { validateEnv } from '../config/env';

/** Respuesta del contenedor whisper (infra/whisper/app.py). */
export interface TranscriptionResult {
  text: string;
  language: string;
  durationS: number;
}

/**
 * Cliente HTTP del contenedor faster-whisper (F4, plan.md §5).
 *
 * El worker manda el WAV por multipart y recibe el texto. Aislar el transporte
 * en un servicio inyectable permite mockearlo en los tests del processor sin
 * levantar whisper, y deja un único sitio donde vive la URL/timeout.
 */
@Injectable()
export class WhisperClient {
  private readonly logger = new Logger(WhisperClient.name);
  private readonly env = validateEnv();

  async transcribe(wavPath: string): Promise<TranscriptionResult> {
    const audio = await readFile(wavPath);
    const form = new FormData();
    // El WAV como Blob: fetch arma el multipart con el boundary correcto.
    form.append('file', new Blob([audio], { type: 'audio/wav' }), 'audio.wav');

    // AbortSignal.timeout corta la request si whisper se cuelga, sin dejar el
    // job pendiendo para siempre (el reintento de BullMQ lo recogerá).
    const res = await fetch(`${this.env.WHISPER_URL}/transcribe`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(this.env.WHISPER_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`whisper respondió ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = (await res.json()) as TranscriptionResult;
    this.logger.log(
      `Transcripción ${data.language} de ${Math.round(data.durationS)}s ` +
        `(${data.text.length} chars)`,
    );
    return data;
  }
}
