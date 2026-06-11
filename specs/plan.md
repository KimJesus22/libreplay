# Plan — LibrePlay

> Documento de **cómo** lo construimos. El **qué** y el **por qué** viven en `spec.md`.
> Estado: v1 — 2026-06-10

## 1. Arquitectura general

```
                ┌──────────────┐
                │   Frontend    │  React + Vite (SPA en español)
                └──────┬───────┘
                       │ HTTPS / JSON
                ┌──────▼───────┐         ┌─────────────────┐
                │   API NestJS  │────────▶│  PostgreSQL 16   │
                │  (REST + JWT) │ Prisma  │   + pgvector     │
                └──┬───────┬───┘         └─────────────────┘
                   │       │ encola jobs
        presigned  │       ▼
        URLs       │  ┌──────────┐      ┌─────────────────┐
                   │  │  Redis    │◀────▶│  Worker NestJS   │
                   │  │  BullMQ   │      │  (pipeline IA)   │
                   │  └──────────┘      └───┬────┬────┬────┘
                   ▼                        │    │    │
            ┌──────────────┐        Whisper │ Claude │ Voyage
            │ Cloudflare R2 │◀──────────────┘  API   │ (embeddings)
            │ (videos MP4)  │   descarga audio       │
            └──────────────┘
```

Dos procesos Node a partir del mismo monorepo NestJS:

- **API** — HTTP síncrono: auth, catálogo, búsqueda, gestión de videos, firma de URLs.
- **Worker** — consumidor de BullMQ: transcripción, metadata IA, embeddings. Si el worker cae, la API sigue sirviendo video (la IA es mejora, no bloqueo — criterio del spec §6).

## 2. Stack y justificación (defendible en entrevista)

| Pieza | Elección | Por qué (y no la alternativa) |
|---|---|---|
| Backend | **NestJS 10 (TypeScript)** | Arquitectura modular con DI, guards y pipes de serie; Swagger integrado (`@nestjs/swagger`) cubre la métrica de docs. Vs Express puro: menos decisiones ad-hoc que explicar. |
| ORM | **Prisma** | Schema declarativo + migraciones versionadas + tipos generados. pgvector se maneja con `Unsupported("vector")` y `$queryRaw` para la búsqueda por similitud. |
| BD | **PostgreSQL 16 + pgvector** (imagen `pgvector/pgvector:pg16`) | Una sola base para datos relacionales **y** vectores: sin servicio extra (vs Pinecone/Qdrant), gratis, y la búsqueda semántica es un `ORDER BY embedding <=> $1`. |
| Colas | **Redis 7 + BullMQ** | El pipeline IA tarda minutos: no puede vivir en el request HTTP. BullMQ da reintentos con backoff, progreso y dead-letter sin infraestructura extra (Redis ya sirve de caché). |
| Almacenamiento | **Cloudflare R2** (API S3) | Egress **gratis** — crítico para streaming de video con presupuesto cero. Soporta peticiones `Range` sobre URLs prefirmadas → el seek (206) sale directo de R2, sin pasar por la API. En dev local se sustituye por **MinIO** (mismo SDK S3). |
| Transcripción | **faster-whisper** (contenedor propio, modelo `small`) | Claude no transcribe audio. Whisper local = costo cero y sin límites de cuota; corre en el compose. Alternativa si el host es muy limitado: API de Groq (Whisper, capa gratuita). |
| Metadata IA | **Claude API** — `claude-opus-4-8`, SDK oficial `@anthropic-ai/sdk` | A partir de la transcripción genera sinopsis, categorías y etiquetas con **structured outputs** (`output_config.format` + schema Zod): JSON válido garantizado, sin parseo frágil. Son pocas llamadas (1 por video subido), costo marginal. Si el presupuesto aprieta, bajar a `claude-haiku-4-5` es un cambio de una línea — decisión del autor. |
| Embeddings | **Voyage AI** (`voyage-3.5-lite`, multilingüe, capa gratuita) | Anthropic no ofrece endpoint de embeddings; Voyage es su proveedor recomendado. Multilingüe → funciona con contenido en español. Vector de la sinopsis+transcripción → pgvector. |
| Frontend | **React 18 + Vite + Tailwind** | Continuidad con el proyecto anterior (React); Vite por velocidad. Reproductor: `<video>` nativo (MP4/H.264 no necesita hls.js — fuera de scope la transcodificación). |
| Docs API | **Swagger** vía `@nestjs/swagger` | Métrica de éxito §8.3, servido en `/docs`. |

## 3. Módulos NestJS

```
apps/
  api/        → AppModule: Auth, Users, Videos, Catalog, Search, Favorites, History, Admin
  worker/     → WorkerModule: TranscriptionProcessor, MetadataProcessor, EmbeddingProcessor
libs/
  prisma/     → PrismaService compartido
  storage/    → S3Client (R2/MinIO), firma de URLs
  queue/      → definición de colas y tipos de jobs
```

| Módulo | Responsabilidad | Endpoints clave |
|---|---|---|
| `auth` | Registro, login, JWT access (15 min) + refresh (7 d, rotado), guards `JwtAuthGuard` + `RolesGuard` | `POST /auth/register`, `/auth/login`, `/auth/refresh` |
| `users` | Perfil propio | `GET/PATCH /me` |
| `videos` | Subida (multipart → presigned PUT a R2), edición de metadata sugerida, publicación, estados | `POST /videos`, `PATCH /videos/:id`, `POST /videos/:id/publish` |
| `catalog` | Listado público por categoría/orden, detalle | `GET /videos`, `GET /videos/:id` |
| `stream` | Emite URL prefirmada de R2 (GET, TTL corto) para el `<video>` | `GET /videos/:id/stream` |
| `search` | Texto (`ILIKE`/`tsvector`) y semántica (embedding de la query → `<=>` en pgvector) | `GET /search?q=&mode=text|semantic` |
| `favorites` / `history` | Favoritos y posición de reproducción (HU-08/09) | `PUT /videos/:id/favorite`, `PUT /videos/:id/progress` |
| `admin` | Ocultar/eliminar cualquier video (HU-10) | `PATCH /admin/videos/:id/hide` |

### Decisión de streaming (criterio §6.1)

La API **no** proxyea bytes de video. `GET /videos/:id/stream` valida auth y devuelve una URL prefirmada de R2 (TTL ~2 h). El `<video>` del navegador emite `Range: bytes=...` directamente contra R2, que responde `206 Partial Content`. Seek < 2 s sin cargar el servidor Node. Defendible: el caso clásico de "no metas archivos grandes por tu API".

## 4. Modelo de datos (Prisma, esencial)

```prisma
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String              // hash argon2
  role      Role     @default(VIEWER)   // VIEWER | UPLOADER | ADMIN
  favorites Favorite[]
  history   WatchProgress[]
}

model Video {
  id          String      @id @default(uuid())
  ownerId     String
  title       String
  description String?
  storageKey  String      // clave en R2
  sizeBytes   Int
  durationS   Int?
  status      VideoStatus @default(PROCESSING) // PROCESSING | READY | PUBLISHED | HIDDEN | FAILED
  synopsis    String?     // generado por IA, editable
  categories  Category[]
  tags        String[]
  transcript  Transcript?
  embedding   Unsupported("vector(1024)")?  // voyage-3.5-lite
  createdAt   DateTime    @default(now())
}

model Transcript { videoId String @id; text String; language String }
model Category   { id Int @id; name String @unique; videos Video[] }
model Favorite   { @@id([userId, videoId]) ... }
model WatchProgress { @@id([userId, videoId]); positionS Int; updatedAt DateTime }
```

Índice vectorial: `CREATE INDEX ON "Video" USING hnsw (embedding vector_cosine_ops);` (migración SQL manual).

## 5. Pipeline IA (BullMQ)

```
upload completado
   └─▶ job: transcribe   (faster-whisper sobre el audio extraído con ffmpeg)
         └─▶ job: metadata    (Claude: sinopsis + categorías + tags, structured output)
               └─▶ job: embed (Voyage: vector de sinopsis+transcript → pgvector)
                     └─▶ video.status = READY (uploader revisa y publica — HU-04)
```

- Cada etapa es un job independiente: reintentos (3, backoff exponencial) y fallo aislado.
- **Fallo total del pipeline** → `status = READY` con campos IA vacíos: publicable manualmente (criterio §6.2).
- Llamada a Claude (worker, TypeScript):

```ts
const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 2048,
  messages: [{ role: "user", content: buildPrompt(transcript, title) }],
  output_config: { format: zodOutputFormat(VideoMetadataSchema) }, // { synopsis, categories[], tags[] }
});
```

- Búsqueda semántica: la query del usuario se embebe con Voyage (`input_type: "query"`) y se compara por coseno; umbral de similitud para no devolver ruido.

## 6. Docker (dev)

`docker-compose.yml` levanta **todo** (criterio §6.5):

| Servicio | Imagen | Puerto |
|---|---|---|
| `db` | `pgvector/pgvector:pg16` | 5432 |
| `redis` | `redis:7-alpine` | 6379 |
| `minio` | `minio/minio` (sustituto local de R2) | 9000/9001 |
| `whisper` | build propio (`faster-whisper` + API HTTP mínima) | 8081 |
| `api` | build del monorepo (target `api`), hot-reload con volumen | 3000 |
| `worker` | build del monorepo (target `worker`) | — |

Secrets (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, claves R2) van en `.env` (gitignored, con `.env.example` versionado).

## 7. Producción (presupuesto ~0)

- **API + Worker + Postgres + Redis:** VPS gratuito (Oracle Cloud Always Free ARM) con el mismo compose, o Fly.io (allowance gratuita). Recomendación: **VPS + compose** — demuestra Docker de punta a punta y es un solo lugar que explicar.
- **R2:** capa gratuita (10 GB + egress gratis) cubre los ~10 videos demo.
- **Frontend:** Cloudflare Pages (gratis).
- **Whisper en prod:** el contenedor corre en el mismo VPS (modelo `small`, CPU); si no alcanza la RAM, fallback a Groq API.

## 8. Seguridad

- Hash de contraseñas con **argon2**; JWT firmado HS256, refresh rotativo en cookie httpOnly.
- `RolesGuard`: `viewer` que llama `POST /videos` → `403`; sin token en endpoints protegidos → `401` (criterio §6.4).
- Validación de subida: MIME + extensión MP4, límite 500 MB (configurable por env), presigned PUT con `content-length-range`.
- Rate limiting (`@nestjs/throttler`) en auth y búsqueda.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Whisper lento en CPU del VPS | Modelo `small`, audio a 16 kHz mono con ffmpeg; criterio §6.2 (5 min de video < 5 min) se valida en F4 — si no llega, Groq API |
| Costo Claude se sale de presupuesto | 1 llamada por video, transcripción truncada a ~30 k caracteres; opción `claude-haiku-4-5` documentada |
| pgvector sin resultados relevantes | Embeber sinopsis+transcript (no solo título); umbral de similitud calibrado con los videos demo |
