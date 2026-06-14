// Tests unitarios del processor de transcripción (F4/F5). NO levanta Redis,
// whisper ni ffmpeg: el objetivo es la LÓGICA de orquestación —caso feliz
// guarda Transcript + encola `metadata` (el video sigue PROCESSING); fallo
// total deja READY publicable (spec §6.2)—. El pipeline real (con whisper de
// verdad) se prueba en scripts/pipeline-demo.mjs.
import { VideoStatus } from '@prisma/client';
import { TranscriptionProcessor } from './transcription.processor';
import * as ffmpeg from './ffmpeg';

// ffmpeg es un import directo (no inyectable): se mockea el módulo entero para
// que `extractAudio` no intente lanzar el binario real.
jest.mock('./ffmpeg');

describe('TranscriptionProcessor', () => {
  const extractAudio = ffmpeg.extractAudio as jest.Mock;

  // Dobles mínimos de las dependencias inyectadas.
  function build() {
    const prisma = {
      video: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      transcript: { upsert: jest.fn().mockResolvedValue(undefined) },
    };
    const storage = { downloadToFile: jest.fn().mockResolvedValue(undefined) };
    const whisper = { transcribe: jest.fn() };
    const metadataQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const processor = new TranscriptionProcessor(
      prisma as never,
      storage as never,
      whisper as never,
      metadataQueue as never,
    );
    return { processor, prisma, storage, whisper, metadataQueue };
  }

  beforeEach(() => {
    extractAudio.mockReset();
    extractAudio.mockResolvedValue(undefined);
  });

  it('caso feliz: baja, extrae, transcribe → Transcript + encola metadata', async () => {
    const { processor, prisma, storage, whisper, metadataQueue } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-1',
      storageKey: 'videos/vid-1.mp4',
    });
    whisper.transcribe.mockResolvedValue({
      text: 'hola mundo',
      language: 'es',
      durationS: 12.7,
    });

    await processor.process({
      data: { videoId: 'vid-1' },
      attemptsMade: 0,
    } as never);

    expect(storage.downloadToFile).toHaveBeenCalledWith(
      'videos/vid-1.mp4',
      expect.stringContaining('input.mp4'),
    );
    expect(extractAudio).toHaveBeenCalled();
    expect(prisma.transcript.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { videoId: 'vid-1' },
        create: { videoId: 'vid-1', text: 'hola mundo', language: 'es' },
      }),
    );
    // durationS redondeado; NO se pone READY (el video sigue PROCESSING hasta
    // que embed lo cierre).
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'vid-1' },
      data: { durationS: 13 },
    });
    // Encola el siguiente eslabón del pipeline.
    expect(metadataQueue.add).toHaveBeenCalledWith('metadata', { videoId: 'vid-1' });
  });

  it('si el video ya no existe, descarta el job sin tocar storage', async () => {
    const { processor, prisma, storage } = build();
    prisma.video.findUnique.mockResolvedValue(null);

    await processor.process({
      data: { videoId: 'borrado' },
      attemptsMade: 0,
    } as never);

    expect(storage.downloadToFile).not.toHaveBeenCalled();
    expect(prisma.video.update).not.toHaveBeenCalled();
  });

  it('whisper lanza → propaga el error (BullMQ reintentará)', async () => {
    const { processor, prisma, whisper } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-2',
      storageKey: 'videos/vid-2.mp4',
    });
    whisper.transcribe.mockRejectedValue(new Error('whisper 500'));

    await expect(
      processor.process({ data: { videoId: 'vid-2' }, attemptsMade: 0 } as never),
    ).rejects.toThrow('whisper 500');
    // No se guardó nada: ni transcript ni cambio de estado.
    expect(prisma.transcript.upsert).not.toHaveBeenCalled();
    expect(prisma.video.update).not.toHaveBeenCalled();
  });

  describe('onFailed (spec §6.2: fallo total → READY publicable)', () => {
    it('reintentos agotados → video a READY', async () => {
      const { processor, prisma } = build();
      await processor.onFailed(
        {
          data: { videoId: 'vid-3' },
          attemptsMade: 3,
          opts: { attempts: 3 },
        } as never,
        new Error('último fallo'),
      );
      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'vid-3' },
        data: { status: VideoStatus.READY },
      });
    });

    it('fallo intermedio (quedan intentos) → no toca el video', async () => {
      const { processor, prisma } = build();
      await processor.onFailed(
        {
          data: { videoId: 'vid-4' },
          attemptsMade: 1,
          opts: { attempts: 3 },
        } as never,
        new Error('fallo transitorio'),
      );
      expect(prisma.video.update).not.toHaveBeenCalled();
    });
  });
});
