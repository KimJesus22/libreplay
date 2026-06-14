// Unit test del adaptador Ollama del puerto MetadataGenerator (F5). Mockea
// fetch: verifica el parseo, la RE-validación Zod (un 3B puede colar basura) y
// el manejo de errores. No levanta Ollama.
import { OllamaMetadataGenerator } from '@app/ai';

function okResponse(content: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ message: { content } }),
  } as Response;
}

const INPUT = { title: 'El despertar', transcript: 'soy un robot', language: 'es' };

describe('OllamaMetadataGenerator', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('devuelve la metadata cuando el LLM responde un JSON válido', async () => {
    // Capturamos la petición desde la implementación (en vez de mock.calls, que
    // queda tipado como any) para asegurar que se manda el `format` a /api/chat.
    let requestUrl = '';
    let requestBody = '';
    fetchMock.mockImplementation((url: string, init: { body: string }) => {
      requestUrl = url;
      requestBody = init.body;
      return Promise.resolve(
        okResponse(
          JSON.stringify({
            synopsis: 'Un robot que aprende a sentir.',
            categories: ['CINE'],
            tags: ['robot', 'emociones'],
          }),
        ),
      );
    });

    const result = await new OllamaMetadataGenerator().generate(INPUT);
    expect(result.synopsis).toBe('Un robot que aprende a sentir.');
    expect(result.categories).toEqual(['CINE']);
    expect(result.tags).toEqual(['robot', 'emociones']);

    expect(requestUrl).toMatch(/\/api\/chat$/);
    expect(JSON.parse(requestBody)).toHaveProperty('format');
  });

  it('JSON inválido del LLM → error legible', async () => {
    fetchMock.mockResolvedValue(okResponse('esto no es json {'));
    await expect(new OllamaMetadataGenerator().generate(INPUT)).rejects.toThrow(
      /no devolvió JSON válido/,
    );
  });

  it('categoría fuera del enum → falla la validación Zod', async () => {
    fetchMock.mockResolvedValue(
      okResponse(
        JSON.stringify({
          synopsis: 'ok',
          categories: ['INVENTADA'],
          tags: [],
        }),
      ),
    );
    await expect(new OllamaMetadataGenerator().generate(INPUT)).rejects.toThrow(
      /no pasó la validación/,
    );
  });

  it('respuesta no-OK de Ollama → error con el status', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('boom'),
    });
    await expect(new OllamaMetadataGenerator().generate(INPUT)).rejects.toThrow(
      /respondió 500/,
    );
  });
});
