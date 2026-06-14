# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).
El mapa de versiones por fase vive en `specs/plan.md` §9.

## [Unreleased]

## [0.6.0] - 2026-06-13

### Added
- Metadata IA y búsqueda (F5, cierra el pipeline IA, plan.md §5): el worker
  encadena `transcribe → metadata → embed`; cada etapa es un job independiente
  con reintentos y fallo aislado, y solo la última (`embed`) deja el video en
  `READY`. El video SIEMPRE alcanza `READY` y es publicable a mano, falle la
  etapa que falle (la IA es mejora, no bloqueo — spec §6.2)
- Generación de metadata por LLM (job `metadata`): `qwen2.5:3b-instruct` vía
  Ollama produce sinopsis + categorías (enum cerrado) + tags desde la
  transcripción, con la salida forzada por JSON Schema (`z.toJSONSchema`) y
  re-validada con Zod. Vive tras el puerto `MetadataGenerator` (lib `@app/ai`):
  el adaptador Ollama es el default $0; cambiar a Claude es reemplazar el
  provider sin tocar el pipeline (plan.md §5)
- Embeddings semánticos (job `embed`): `bge-m3` vía Ollama embebe
  sinopsis+transcript (1024 dims) y los guarda en `Video.embedding` (pgvector)
  con índice HNSW (`vector_cosine_ops`)
- Búsqueda pública `GET /search?q=&mode=text|semantic` (módulo `search`, HU-07,
  §6.3): modo `text` con `tsvector` español (columna generada `searchVector` +
  índice GIN, ordenado por `ts_rank`) y modo `semantic` por distancia coseno
  (`<=>`) con umbral para descartar ruido. Solo videos `PUBLISHED`; la
  proyección nunca expone `storageKey`
- Flujo de revisión del uploader (HU-04): `GET /videos/:id/review` (solo el
  dueño) devuelve el video con las sugerencias IA y la transcripción;
  `PATCH /videos/:id` ahora también edita `synopsis` y `tags` antes de publicar
- Lib compartida `@app/ai`: `EmbeddingsService` (bge-m3, usado por worker y API)
  y el puerto `MetadataGenerator` + `OllamaMetadataGenerator`
- Servicio `ollama` en `docker-compose.yml` (`infra/ollama`): baja
  `qwen2.5:3b-instruct` y `bge-m3` al primer arranque (cacheados en volumen),
  healthcheck que gatea al worker hasta que los modelos están listos. El stack
  IA sigue sin necesitar ninguna API key — costo $0 (plan.md §7)
- Tests unitarios de los nuevos processors (`metadata`, `embed`) y del adaptador
  Ollama; e2e de búsqueda (texto y semántico, este último hermético: el servicio
  de embeddings se sobreescribe para no depender de Ollama) y del flujo de
  revisión del uploader
- Script de demo `scripts/metadata-search-demo.mjs`: sube un video con voz,
  espera el pipeline completo y comprueba que la búsqueda semántica lo encuentra
  sin coincidencia de título

### Changed
- `Video` gana `synopsis`, `tags`, `embedding` (`vector(1024)`) y la columna
  generada `searchVector` (`tsvector`); migración `20260613193000_add_metadata_search`
- El job `transcribe` ya NO deja el video en `READY` al terminar: encola
  `metadata` y el video sigue `PROCESSING` hasta el final del pipeline

## [0.5.0] - 2026-06-13

### Added
- Pipeline de transcripción (F4, primer eslabón del pipeline IA, plan.md §5):
  al confirmar una subida la API encola un job `transcribe` y el video pasa a
  `PROCESSING`; el worker BullMQ extrae el audio con ffmpeg, lo manda al
  contenedor faster-whisper y guarda la transcripción, devolviendo el video a
  `READY` — todo sin intervención manual (criterio §6.2)
- Contenedor `whisper` (`infra/whisper`): faster-whisper (`small`, int8 en CPU,
  $0) tras una API HTTP FastAPI (`POST /transcribe`, `GET /health`); modelo
  configurable por `WHISPER_MODEL`
- Worker BullMQ operativo (`apps/worker`): `TranscriptionProcessor` con
  reintentos (3, backoff exponencial); si el pipeline agota los intentos el
  video queda `READY` con campos IA vacíos, publicable a mano (la IA es mejora,
  no bloqueo — spec §6.2)
- Modelo `Transcript` (1:1 con `Video`) y `Video.durationS` (migración
  `20260613184012_add_transcript_pipeline`)
- Lib compartida `@app/queue`: nombres de cola, tipos de job y conexión Redis
  compartidos entre la API (productor) y el worker (consumidor)
- `StorageService.downloadToFile()`: el worker baja el MP4 del storage para
  extraer el audio (los bytes tampoco pasan por la API aquí)
- Servicios `whisper` y `worker` en `docker-compose.yml` (con healthcheck de
  Redis y whisper); `docker compose up` levanta el pipeline completo (§6.5)
- Tests unitarios del worker (`pnpm test:unit`, sin servicios externos) y paso
  `test:unit` en CI; script de demo `scripts/pipeline-demo.mjs` (subida →
  transcripción en BD, cronometrada)

### Changed
- `POST /videos/:id/confirm` ahora deja el video en `PROCESSING` (antes
  `READY`): el pipeline IA arranca solo. Si Redis está caído, cae a `READY`
  (publicable) sin romper la subida
- Los e2e (`videos`, `catalog`) requieren Redis arriba (`/confirm` encola); el
  helper `uploadReady` fuerza `READY` en BD para simular el fin del pipeline

## [0.4.0] - 2026-06-13

### Added
- Catálogo público (F3, HU-05): `GET /videos` sin autenticación (módulo
  `catalog`) — solo videos `PUBLISHED`, con filtro por categoría, orden por
  novedades (`recent`) o popularidad (`popular`) y paginación obligatoria
- `GET /videos/:id`: detalle público de un video publicado (`404` si no existe
  o no está publicado); la proyección pública nunca expone `storageKey`
- Streaming (F3, HU-06, criterio §6.1): `GET /videos/:id/stream` (módulo
  `stream`, requiere sesión) devuelve una URL prefirmada GET con TTL de 2 h; el
  navegador hace `Range: bytes=...` directo contra el storage → `206 Partial
  Content`, los bytes nunca pasan por la API
- `POST /videos/:id/publish`: pasa un video de `READY` a `PUBLISHED` y sella
  `publishedAt` (no-`READY` → `409`)
- Contador de vistas (`Video.views`): se incrementa al pedir la URL de stream
  (una reproducción ≈ una vista); ordena el catálogo "popular"
- Categorías como enum cerrado `Category` (migración
  `20260613135433_add_catalog_streaming`), editables por el uploader vía
  `PATCH /videos/:id` — la IA las sugerirá en F5
- `StorageService.presignedGetUrl()` para firmar URLs de lectura
- Tests e2e de catálogo y streaming (`catalog.e2e-spec.ts`): publicación,
  filtros, y `Range` → `206` con fetch real contra MinIO (28 e2e en total)
- El script `scripts/upload-demo.mjs` ahora cubre el flujo completo F2+F3:
  subir → publicar → URL de stream → `Range` → `206`

## [0.3.0] - 2026-06-13

### Added
- Subida de videos por presigned PUT (F2, HU-03): `POST /videos` valida MP4 y
  tamaño ≤ 500 MB (`MAX_VIDEO_SIZE_MB` configurable) y firma una URL PUT atada
  a Content-Type y Content-Length — los bytes del video nunca pasan por la API
- `POST /videos/:id/confirm`: la API verifica el objeto real en storage
  (HeadObject) antes de marcar el video `READY`; tamaño ≠ declarado → descarta
- `PATCH /videos/:id` (título/descripción) y `DELETE /videos/:id`, ambos solo
  del dueño (ajeno → `403`); todo el controller exige rol `UPLOADER`/`ADMIN`
- Modelo `Video` con estados `UPLOADING`/`PROCESSING`/`READY`/`PUBLISHED`/
  `HIDDEN`/`FAILED` (migración `20260612150623_add_video_upload`)
- Lib compartida `@app/storage`: cliente S3 único para MinIO (dev) y
  Cloudflare R2 (prod), con firma de URLs por endpoint público separado
- Script de demo `scripts/upload-demo.mjs`: flujo completo login → registro →
  PUT con progreso → confirmación contra MinIO real
- Tests e2e de videos (`videos.e2e-spec.ts`): PUT real contra MinIO, rechazo de
  Content-Type no firmado, validaciones y propiedad

### Changed
- El test de `403` de §6.4 ahora apunta al endpoint real `POST /videos` en vez
  del controller de prueba del e2e
- `test:e2e` corre con `--experimental-vm-modules` (vía `cross-env`): el AWS SDK
  hace un `import()` dinámico que el VM de Jest rechaza sin ese flag
- `docker compose`: la API recibe variables `S3_*` y `JWT_SECRET`, y depende del
  servicio `minio`

## [0.2.0] - 2026-06-12

### Added
- Auth completa (F1): `POST /auth/register`, `POST /auth/login` y
  `POST /auth/refresh` con passwords argon2id, access JWT de 15 min y
  refresh de 7 días rotativo en cookie httpOnly (`Path=/auth`)
- Modelo `User` con roles `VIEWER`/`UPLOADER`/`ADMIN`
  (migración `20260612041027_add_user_auth`)
- Guards globales `JwtAuthGuard` + `RolesGuard` (criterio §6.4: sin token →
  `401`, rol insuficiente → `403`) con decoradores `@Public()` y `@Roles()`
- Validación de variables de entorno al arrancar (zod) y de DTOs en todos
  los endpoints (`ValidationPipe` + class-validator)
- Semilla de usuario admin idempotente (`pnpm prisma:seed`)
- Tests e2e de auth (jest + supertest, `pnpm test:e2e`): registro, login,
  guards 401/403 y rotación del refresh token
- Botón "Authorize" (bearer) en Swagger

## [0.1.0] - 2026-06-11

### Added
- Monorepo pnpm con NestJS: apps `api` y `worker`, lib compartida `libs/shared`
- Prisma + PostgreSQL con extensión pgvector (migración inicial `20260611000000_init`)
- Endpoint `GET /health` con ping real a la base de datos (Terminus) y Swagger en `/docs`
- Entorno de desarrollo completo con `docker compose up`: Postgres (pgvector),
  Redis, MinIO y la API con migraciones automáticas al arrancar
- ESLint + Prettier y pipeline de CI (lint + build)
- Documentos de spec-driven development: `specs/spec.md`, `specs/plan.md`, `specs/tasks.md`
- Guía para agentes (`AGENTS.md`) y esquema de releases

### Changed
- Restricción dura de costo $0: IA 100% local (Ollama + faster-whisper) en lugar
  de APIs de pago; hosting solo en capas gratuitas permanentes
