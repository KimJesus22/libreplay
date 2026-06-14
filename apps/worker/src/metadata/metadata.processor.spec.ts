// Unit tests del processor de metadata (F5). Sin Ollama ni Redis: se mockea el
// puerto MetadataGenerator y la cola embed. Verifican la orquestación —guardar
// sugerencias + encolar embed; degradación cuando no hay transcript o se agotan
// los reintentos (spec §6.2)—. El LLM real se prueba en el demo end-to-end.
import { MetadataProcessor } from './metadata.processor';

describe('MetadataProcessor', () => {
  function build() {
    const prisma = {
      video: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const generator = { generate: jest.fn() };
    const embedQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const processor = new MetadataProcessor(
      prisma as never,
      generator,
      embedQueue as never,
    );
    return { processor, prisma, generator, embedQueue };
  }

  const META = {
    synopsis: 'Un robot que aprende a sentir.',
    categories: ['CINE'],
    tags: ['robot', 'emociones'],
  };

  it('caso feliz: genera, guarda sugerencias y encola embed', async () => {
    const { processor, prisma, generator, embedQueue } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-1',
      title: 'El despertar',
      transcript: { text: 'hola soy un robot', language: 'es' },
    });
    generator.generate.mockResolvedValue(META);

    await processor.process({ data: { videoId: 'vid-1' }, attemptsMade: 0 } as never);

    expect(generator.generate).toHaveBeenCalledWith({
      title: 'El despertar',
      transcript: 'hola soy un robot',
      language: 'es',
    });
    expect(prisma.video.update).toHaveBeenCalledWith({
      where: { id: 'vid-1' },
      data: { synopsis: META.synopsis, categories: META.categories, tags: META.tags },
    });
    expect(embedQueue.add).toHaveBeenCalledWith('embed', { videoId: 'vid-1' });
  });

  it('video inexistente: descarta sin generar ni encolar', async () => {
    const { processor, prisma, generator, embedQueue } = build();
    prisma.video.findUnique.mockResolvedValue(null);

    await processor.process({ data: { videoId: 'x' }, attemptsMade: 0 } as never);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(embedQueue.add).not.toHaveBeenCalled();
  });

  it('sin transcript: salta metadata pero encola embed (degradación)', async () => {
    const { processor, prisma, generator, embedQueue } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-2',
      title: 'Sin audio',
      transcript: null,
    });

    await processor.process({ data: { videoId: 'vid-2' }, attemptsMade: 0 } as never);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(prisma.video.update).not.toHaveBeenCalled();
    expect(embedQueue.add).toHaveBeenCalledWith('embed', { videoId: 'vid-2' });
  });

  it('el LLM lanza → propaga el error (BullMQ reintentará)', async () => {
    const { processor, prisma, generator } = build();
    prisma.video.findUnique.mockResolvedValue({
      id: 'vid-3',
      title: 't',
      transcript: { text: 'x', language: 'es' },
    });
    generator.generate.mockRejectedValue(new Error('ollama 500'));

    await expect(
      processor.process({ data: { videoId: 'vid-3' }, attemptsMade: 0 } as never),
    ).rejects.toThrow('ollama 500');
  });

  describe('onFailed (spec §6.2: fallo aislado no detiene el pipeline)', () => {
    it('reintentos agotados → encola embed igual', async () => {
      const { processor, embedQueue } = build();
      await processor.onFailed(
        { data: { videoId: 'vid-4' }, attemptsMade: 3, opts: { attempts: 3 } } as never,
        new Error('último fallo'),
      );
      expect(embedQueue.add).toHaveBeenCalledWith('embed', { videoId: 'vid-4' });
    });

    it('fallo intermedio → no encola nada', async () => {
      const { processor, embedQueue } = build();
      await processor.onFailed(
        { data: { videoId: 'vid-5' }, attemptsMade: 1, opts: { attempts: 3 } } as never,
        new Error('transitorio'),
      );
      expect(embedQueue.add).not.toHaveBeenCalled();
    });
  });
});
