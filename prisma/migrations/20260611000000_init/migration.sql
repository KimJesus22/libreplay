-- Migración inicial (F0): la BD nace "vacía" pero con pgvector habilitado.
-- Las columnas vector(1024) y el índice HNSW llegan en F5; habilitar la
-- extensión desde el día cero garantiza que cualquier entorno (dev, CI,
-- prod) ya la tiene cuando esas migraciones lleguen.
CREATE EXTENSION IF NOT EXISTS "vector";
