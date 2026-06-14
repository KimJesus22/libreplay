-- F5 — Metadata IA y búsqueda (plan.md §5, §6.3).
-- Añade los campos IA que faltaban en Video y la infraestructura de búsqueda
-- (full-text + vectorial). Escrita a mano: Prisma no emite la cláusula
-- GENERATED de `searchVector` ni los índices de tipos Unsupported (vector/tsvector).

-- AlterTable: campos IA. synopsis/tags los rellena el job `metadata`; embedding
-- el job `embed`. tags arranca como array vacío (igual que categories).
ALTER TABLE "Video" ADD COLUMN     "synopsis" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "embedding" vector(1024);

-- Columna full-text GENERADA por Postgres a partir de título + descripción +
-- sinopsis. STORED: se materializa y se indexa (a diferencia de recomputar
-- to_tsvector en cada query). 'spanish': la interfaz y el contenido son en
-- español (spec §7) — aplica stemming/stopwords del idioma. coalesce evita que
-- un campo NULL anule el vector entero.
ALTER TABLE "Video" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'spanish',
      coalesce("title", '') || ' ' ||
      coalesce("description", '') || ' ' ||
      coalesce("synopsis", '')
    )
  ) STORED;

-- Índice GIN para el modo `text` de GET /search (`searchVector @@ query`).
CREATE INDEX "Video_searchVector_idx" ON "Video" USING gin ("searchVector");

-- Índice HNSW para la búsqueda semántica por coseno (`embedding <=> $1`).
-- vector_cosine_ops empareja con el operador <=> que usa search.service.
CREATE INDEX "Video_embedding_idx" ON "Video" USING hnsw ("embedding" vector_cosine_ops);
