// Unit tests del processor de embeddings (F5), etapa terminal. Sin Ollama ni
// BD: se mockea EmbeddingsService y Prisma. Verifican que embebe el texto
// correcto, escribe el vector y deja READY; y la degradación (sin texto / fallo
// total → READY igual, spec §6.2).
import { VideoStatus } from '@prisma/client';
import { EmbeddingProcessor } from './embedding.processor';

describe('EmbeddingProcessor', () => {
  function build() {
    const prisma = {
      video: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const embeddings = { embed: jest.fn() };
    const processor = new EmbeddingProcessor(prisma as never, embeddings as never);
    return { processor, prisma, embeddings };
  }

  it('caso feliz: embebe synopsis+transcript, guarda vector y deja READY', async () => {
    const { processor, prisma, embeddings } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-1',
      synopsis: 'Un robot que siente',
      transcript: { text: 'hola mundo' },
    });
    embeddings.embed.mockResolvedValue(new Array(1024).fill(0.1));

    await processor.process({ data: { videoId: 'vid-1' }, attemptsMade: 0 } as never);

    // Embebe sinopsis + transcript unidos.
    expect(embeddings.embed).toHaveBeenCalledWith('Un robot que siente\n\nhola mundo');
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'vid-1' },
      data: { status: VideoStatus.READY },
    });
  });

  it('sin texto (pipeline degradado): pasa a READY sin embeber', async () => {
    const { processor, prisma, embeddings } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-2',
      synopsis: null,
      transcript: null,
    });

    await processor.process({ data: { videoId: 'vid-2' }, attemptsMade: 0 } as never);

    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'vid-2' },
      data: { status: VideoStatus.READY },
    });
  });

  it('video inexistente: descarta sin tocar nada', async () => {
    const { processor, prisma, embeddings } = build();
    prisma.video.findUnique.mockResolvedValue(null);

    await processor.process({ data: { videoId: 'x' }, attemptsMade: 0 } as never);

    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(prisma.video.update).not.toHaveBeenCalled();
  });

  it('embed lanza → propaga el error (BullMQ reintentará)', async () => {
    const { processor, prisma, embeddings } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-3',
      synopsis: 's',
      transcript: { text: 't' },
    });
    embeddings.embed.mockRejectedValue(new Error('ollama embed 500'));

    await expect(
      processor.process({ data: { videoId: 'vid-3' }, attemptsMade: 0 } as never),
    ).rejects.toThrow('ollama embed 500');
    expect(prisma.video.update).not.toHaveBeenCalled();
  });

  describe('onFailed (spec §6.2)', () => {
    it('reintentos agotados → video a READY sin embedding', async () => {
      const { processor, prisma } = build();
      await processor.onFailed(
        { data: { videoId: 'vid-4' }, attemptsMade: 3, opts: { attempts: 3 } } as never,
        new Error('último fallo'),
      );
      expect(prisma.video.update).toHaveBeenCalledWith({
        where: { id: 'vid-4' },
        data: { status: VideoStatus.READY },
      });
    });

    it('fallo intermedio → no toca el video', async () => {
      const { processor, prisma } = build();
      await processor.onFailed(
        { data: { videoId: 'vid-5' }, attemptsMade: 1, opts: { attempts: 3 } } as never,
        new Error('transitorio'),
      );
      expect(prisma.video.update).not.toHaveBeenCalled();
    });
  });
});
