# Plan — LibrePlay

> Documento de **cómo** lo construimos. El **qué** y el **por qué** viven en `spec.md`.
> Estado: v1 — 2026-06-10

## 1. Arquitectura general

```
                ┌──────────────┐
                │   Frontend    │  Astro + TypeScript + Tailwind (es)
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
            ┌──────────────┐        Whisper │ Ollama │ Ollama
            │ Cloudflare R2 │◀──────────────┘  (LLM) │ bge-m3
            │ (videos MP4)  │   descarga audio       │ (embeddings)
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
| Metadata IA | **Ollama** local (`qwen2.5:3b-instruct`) tras un puerto `MetadataGenerator` | **Costo $0 absoluto**: el LLM corre en el compose, sin API key ni cuota. Genera sinopsis, categorías y etiquetas desde la transcripción con salida JSON forzada por schema (`format` de Ollama) + validación Zod. El puerto hexagonal permite enchufar un adaptador Claude (`@anthropic-ai/sdk`) cambiando una variable de entorno si algún día hay presupuesto — y es un buen punto de diseño para la entrevista. |
| Embeddings | **Ollama** local (`bge-m3`, multilingüe, 1024 dims) | Costo $0 y sin cuota (vs Voyage/OpenAI: gratis pero con límites y key). Multilingüe → funciona con contenido en español; 1024 dimensiones encajan con `vector(1024)`. Mismo modelo embebe documentos y queries → consistencia en la búsqueda semántica. |
| Frontend | **Astro + TypeScript + Tailwind CSS** | El sitio es mayormente contenido (catálogo, detalle): la arquitectura de islas de Astro envía ~0 JS por defecto y solo hidrata lo interactivo (player, búsqueda, formularios) — mejor rendimiento que una SPA y un argumento técnico distinto al típico portafolio React. Islas en TS vanilla/componentes Astro, sin framework extra. Reproductor: `<video>` nativo (MP4/H.264 no necesita hls.js — fuera de scope la transcodificación). |
| Docs API | **Swagger** vía `@nestjs/swagger` | Métrica de éxito §8.3, servido en `/docs`. |

## 3. Módulos NestJS

```
apps/
  api/        → AppModule: Auth, Users, Videos, Catalog, Search, Favorites, History, Admin
  worker/     → WorkerModule: TranscriptionProcessor, MetadataProcessor, EmbeddingProcessor
  web/        → Astro + TS + Tailwind (consume la API REST; islas para player/búsqueda/subida)
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
         └─▶ job: metadata    (Ollama LLM: sinopsis + categorías + tags, JSON por schema)
               └─▶ job: embed (Ollama bge-m3: vector de sinopsis+transcript → pgvector)
                     └─▶ video.status = READY (uploader revisa y publica — HU-04)
```

- Cada etapa es un job independiente: reintentos (3, backoff exponencial) y fallo aislado.
- **Fallo total del pipeline** → `status = READY` con campos IA vacíos: publicable manualmente (criterio §6.2).
- La generación de metadata vive detrás de un puerto, con Ollama como adaptador por defecto:

```ts
interface MetadataGenerator {
  generate(transcript: string, title: string): Promise<VideoMetadata>; // validado con Zod
}

// OllamaMetadataGenerator (default, $0): POST /api/chat con
// { model: "qwen2.5:3b-instruct", format: zodToJsonSchema(VideoMetadataSchema) }
// ClaudeMetadataGenerator (opcional, METADATA_PROVIDER=claude):
// client.messages.parse({ model: "claude-opus-4-8", output_config: { format: zodOutputFormat(...) } })
```

- Búsqueda semántica: la query del usuario se embebe con el mismo `bge-m3` y se compara por coseno; umbral de similitud para no devolver ruido.

## 6. Docker (dev)

`docker-compose.yml` levanta **todo** (criterio §6.5):

| Servicio | Imagen | Puerto |
|---|---|---|
| `db` | `pgvector/pgvector:pg16` | 5432 |
| `redis` | `redis:7-alpine` | 6379 |
| `minio` | `minio/minio` (sustituto local de R2) | 9000/9001 |
| `whisper` | build propio (`faster-whisper` + API HTTP mínima) | 8081 |
| `ollama` | `ollama/ollama` (modelos `qwen2.5:3b-instruct` + `bge-m3`, pull en init) | 11434 |
| `api` | build del monorepo (target `api`), hot-reload con volumen | 3000 |
| `worker` | build del monorepo (target `worker`) | — |

**El stack IA no necesita ninguna API key.** Los únicos secrets son las claves R2 (solo producción; en dev MinIO usa credenciales locales) y el secreto JWT — van en `.env` (gitignored, con `.env.example` versionado).

## 7. Producción (costo $0 — restricción dura)

**Regla del proyecto: ninguna pieza puede generar factura.** Nada de APIs de pago ni "gratis con tarjeta que luego cobra". Presupuesto total: $0.

| Pieza | Servicio | Costo |
|---|---|---|
| API + Worker + Postgres + Redis + Whisper + Ollama | **Oracle Cloud Always Free** (VM ARM, hasta 4 OCPU / 24 GB RAM) con el mismo compose | $0 permanente |
| Almacenamiento de video | **Cloudflare R2** capa gratuita: 10 GB + egress ilimitado gratis (10 videos × ≤500 MB ≈ 5 GB, entra) | $0 |
| Frontend | **Cloudflare Pages** → `libreplay.pages.dev` | $0 |
| Dominio API | **Sin dominio comprado**: subdominio gratis (DuckDNS) apuntando al VPS, HTTPS con Caddy (Let's Encrypt) | $0 |
| IA (transcripción, metadata, embeddings) | Whisper + Ollama en el propio VPS — sin API keys ni cuotas | $0 |
| CI + repo + releases | GitHub Free | $0 |

- Los 24 GB de RAM del Always Free ARM aguantan Postgres + Redis + whisper `small` + `qwen2.5:3b` + `bge-m3` con margen.
- Plan B si Oracle no da disponibilidad de la VM: dividir el compose entre dos hosts gratuitos (p. ej. Fly.io allowance) manteniendo la regla $0.

## 8. Seguridad

- Hash de contraseñas con **argon2**; JWT firmado HS256, refresh rotativo en cookie httpOnly.
- `RolesGuard`: `viewer` que llama `POST /videos` → `403`; sin token en endpoints protegidos → `401` (criterio §6.4).
- Validación de subida: MIME + extensión MP4, límite 500 MB (configurable por env), presigned PUT con `content-length-range`.
- Rate limiting (`@nestjs/throttler`) en auth y búsqueda.

## 9. Releases y versionado

- **SemVer** con tags anotados (`vX.Y.Z`) + **GitHub Releases** con notas por versión.
- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`…) — ya en uso; permiten generar el changelog a partir del historial.
- **`CHANGELOG.md`** en formato [Keep a Changelog](https://keepachangelog.com/es-ES/), actualizado en cada release.
- Antes de 1.0 la API puede romper sin aviso (regla SemVer 0.x). Cada fase cerrada = un minor:

| Versión | Hito (fase de tasks.md) |
|---|---|
| `v0.1.0` | F0 — entorno reproducible (`docker compose up` + health + Swagger) |
| `v0.2.0` | F1 — auth y roles |
| `v0.3.0` | F2 — subida a R2/MinIO |
| `v0.4.0` | F3 — catálogo y streaming con seek (206) |
| `v0.5.0` | F4 — transcripción automática |
| `v0.6.0` | F5 — metadata IA + búsqueda semántica |
| `v0.7.0` | F6 — favoritos, historial, admin |
| `v0.8.0` | F7 — frontend Astro completo |
| `v1.0.0-rc.1` | F8 parcial — desplegado en URL pública, en validación |
| **`v1.0.0`** | F8 cerrada — métricas de éxito del spec §8 cumplidas (URL pública + 10 videos + docs + README con demo) |

Flujo por release: cerrar la fase → actualizar `CHANGELOG.md` → `git tag -a vX.Y.Z` → push del tag → GitHub Release con las notas (qué se puede demostrar en esa versión). Parches sobre una versión publicada → `vX.Y.Z+1` con `fix:`.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| Whisper lento en CPU del VPS | Modelo `small`, audio a 16 kHz mono con ffmpeg; criterio §6.2 (5 min de video < 5 min) se valida en F4 — si no llega, Groq API (capa gratuita, sigue siendo $0) |
| LLM de 3B genera metadata pobre (sinopsis genéricas, categorías erradas) | Salida forzada por schema + categorías como enum cerrado; prompt con few-shot; el uploader siempre revisa antes de publicar (HU-04). Escalar a `qwen2.5:7b` si la RAM lo permite; el puerto `MetadataGenerator` deja enchufar Claude sin tocar el pipeline |
| pgvector sin resultados relevantes | Embeber sinopsis+transcript (no solo título); umbral de similitud calibrado con los videos demo |
| Oracle recicla la VM Always Free por inactividad | Uptime monitor gratuito (UptimeRobot) + backups de BD a R2; el compose reconstruye todo en minutos |
