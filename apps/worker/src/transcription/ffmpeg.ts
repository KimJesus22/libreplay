import { spawn } from 'node:child_process';

/**
 * Extrae el audio de un video a WAV PCM 16 kHz mono con ffmpeg (F4).
 *
 * Por qué este formato exacto: faster-whisper resamplea internamente a 16 kHz
 * mono de todos modos; dárselo ya así evita trabajo doble y el WAV PCM es lo
 * más universal (sin depender de códecs). `-vn` descarta el video (no lo
 * necesitamos) → el archivo que viaja a whisper es mucho más pequeño que el MP4.
 *
 * Se invoca el binario ffmpeg del sistema (instalado en el contenedor del
 * worker) en vez de una lib JS: ffmpeg nativo es el estándar y no hay binding
 * de Node que lo haga mejor. spawn (no exec) para no bufferizar la salida en
 * memoria —irrelevante aquí porque escribimos a archivo, pero es el patrón sano—.
 */
export function extractAudio(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', // sobrescribe el output sin preguntar
      '-i',
      inputPath,
      '-vn', // sin video
      '-ac',
      '1', // mono
      '-ar',
      '16000', // 16 kHz
      '-f',
      'wav',
      outputPath,
    ]);

    // ffmpeg escribe su log por stderr; lo capturamos para el mensaje de error.
    let stderr = '';
    ff.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ff.on('error', reject); // ffmpeg no está instalado / no se pudo lanzar
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg salió con código ${code}: ${stderr.slice(-500)}`));
    });
  });
}
