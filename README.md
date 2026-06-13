<div align="center">

# 🎬 LibrePlay

**Plataforma libre de streaming de video con catalogación automática por IA**

[![CI](https://github.com/KimJesus22/libreplay/actions/workflows/ci.yml/badge.svg)](https://github.com/KimJesus22/libreplay/actions/workflows/ci.yml)
![Version](https://img.shields.io/badge/version-0.3.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?logo=typescript&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?logo=docker&logoColor=white)
![Cost](https://img.shields.io/badge/costo%20total-$0-success)

Subes un MP4 → el pipeline de IA lo cataloga solo: transcribe el audio, genera sinopsis/categorías/tags con un LLM local y crea embeddings para **búsqueda semántica**. Buscar *"robot que aprende a sentir"* encuentra el video correcto aunque el título no coincida.

**Restricción dura: costo total $0.** Todo el stack — transcripción, LLM, embeddings, hosting — corre en servicios gratuitos o locales. Sin API keys de pago, sin tarjetas de crédito.

<!-- DEUDA (F8): Aquí va el GIF/video demo cuando la UI esté lista (métrica §8.2) -->
<!-- ![Demo](docs/assets/demo.gif) -->

[Documentación API (Swagger)](#api-reference) · [Arquitectura](#arquitectura) · [Inicio rápido](#-inicio-rápido) · [Roadmap](#-roadmap)

</div>

---

## ✨ Características principales

| Característica | Descripción | Estado |
|---|---|:---:|
| 🔐 **Auth JWT completa** | Registro, login, access token (15 min) + refresh rotativo (7 d) en cookie httpOnly, roles VIEWER/UPLOADER/ADMIN | ✅ |
| 📤 **Subida presigned** | El video viaja directo a R2/MinIO por URL prefirmada — nunca pasa por la API | ✅ |
| 🎥 **Streaming con seek** | `Range: bytes=...` → `206 Partial Content` directo desde R2; seek < 2 s | 🔜 |
| 🤖 **Pipeline IA automático** | Transcripción (faster-whisper) → metadata (Ollama LLM) → embeddings (bge-m3) | 🔜 |
| 🔍 **Búsqueda semántica** | pgvector + cosine similarity: encuentra videos por significado, no solo por título | 🔜 |
| ⭐ **Favoritos + historial** | Marca favoritos y retoma donde lo dejaste | 🔜 |
| 🛡️ **Panel admin** | Moderación: ocultar/eliminar videos | 🔜 |
| 🌐 **Frontend Astro** | Islas interactivas: ~0 JS por defecto, solo hidrata lo necesario | 🔜 |

> 🚧 **Fase actual: F2 completada (subida de videos).** El progreso detallado vive en [`specs/tasks.md`](specs/tasks.md).

---

## 🏗️ Arquitectura

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

### Decisiones de diseño clave

> Cada decisión está pensada para ser **defendible en una entrevista técnica**. La justificación completa vive en [`specs/plan.md`](specs/plan.md).

| Decisión | Por qué | Alternativa descartada |
|---|---|---|
| **Video nunca pasa por la API** | URLs prefirmadas a R2 → el navegador hace `Range` requests directo; la API no es bottleneck de I/O | Proxy de bytes por Node (memoria y latencia) |
| **Una sola BD para datos + vectores** | PostgreSQL + pgvector = datos relacionales Y búsqueda semántica sin otro servicio | Pinecone/Qdrant (costo, operación extra) |
| **IA 100% local** | Ollama + faster-whisper en Docker: $0, sin API keys, sin cuotas | OpenAI/Claude APIs (costo, vendor lock-in) |
| **Puerto hexagonal para el LLM** | `MetadataGenerator` interface → swap Ollama ↔ Claude cambiando una env var | Hard-code del proveedor |
| **Pipeline no bloquea publicación** | Si la IA falla, el video queda `READY` con campos vacíos: publicable manualmente | Bloquear hasta que la IA termine |
| **Astro con islas** | ~0 JS por defecto, solo hidrata player/búsqueda/subida: mejor perf que SPA | React SPA (bundle innecesario) |

---

## 🛠️ Stack técnico

| Capa | Tecnología | Justificación |
|---|---|---|
| **Backend** | NestJS 10 + TypeScript | Arquitectura modular con DI, guards y pipes; Swagger integrado |
| **ORM** | Prisma 6 | Schema declarativo, migraciones versionadas, tipos generados |
| **Base de datos** | PostgreSQL 16 + pgvector | Datos relacionales + vectores en una sola BD |
| **Colas** | Redis 7 + BullMQ | Pipeline IA asíncrono con reintentos y backoff exponencial |
| **Almacenamiento** | Cloudflare R2 / MinIO (dev) | Egress gratis, API S3 compatible |
| **Transcripción** | faster-whisper (modelo `small`) | Whisper local = costo $0, sin límites |
| **LLM (metadata)** | Ollama (`qwen2.5:3b-instruct`) | JSON forzado por schema + validación Zod |
| **Embeddings** | Ollama (`bge-m3`, 1024 dims) | Multilingüe, consistente para query y documentos |
| **Frontend** | Astro + TypeScript + Tailwind CSS | Islas interactivas, HTML estático/SSR por defecto |
| **Auth** | JWT (HS256) + argon2id | Access 15 min + refresh rotativo 7 d en cookie httpOnly |
| **CI** | GitHub Actions | Lint + build en cada push/PR |
| **Docs** | Swagger (`@nestjs/swagger`) | Documentación interactiva auto-generada |

---

## 🚀 Inicio rápido

### Con Docker (recomendado)

> **Requisitos:** Docker + Docker Compose. Eso es todo — no hay API keys que conseguir.

```bash
# 1. Clonar el repositorio
git clone https://github.com/KimJesus22/libreplay.git
cd libreplay

# 2. Configurar variables de entorno
cp .env.example .env

# 3. Levantar todo el entorno
docker compose up
```

Las migraciones de Prisma se aplican automáticamente al arrancar. Una vez listo:

| Servicio | URL |
|---|---|
| 🏥 Health check | http://localhost:3000/health |
| 📖 Swagger (API docs) | http://localhost:3000/docs |
| 📦 Consola MinIO | http://localhost:9001 |

### Sin Docker

> **Requisitos:** Node ≥ 22, pnpm, PostgreSQL y Redis corriendo localmente.

```bash
pnpm install
pnpm prisma:generate    # Genera el cliente Prisma
pnpm prisma:migrate     # Aplica migraciones (dev)
pnpm prisma:seed        # Crea usuario admin de prueba
pnpm start:api          # API con hot reload (http://localhost:3000)
pnpm start:worker       # Worker BullMQ (placeholder hasta F4)
```

### Variables de entorno

Todas las variables están documentadas en [`.env.example`](.env.example). Las esenciales:

| Variable | Descripción | Default (dev) |
|---|---|---|
| `DATABASE_URL` | Conexión PostgreSQL | `postgresql://libreplay:libreplay@localhost:5432/libreplay` |
| `REDIS_URL` | Conexión Redis | `redis://localhost:6379` |
| `JWT_SECRET` | Secreto para firmar tokens | ⚠️ Cambiar en producción |
| `S3_ENDPOINT` | Endpoint S3 (MinIO/R2) | `http://localhost:9000` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Credenciales S3 | `libreplay` / `libreplay123` |
| `S3_BUCKET` | Bucket para videos | `videos` |

---

## 📁 Estructura del proyecto

```
libreplay/
├── apps/
│   ├── api/                    # API REST (NestJS)
│   │   ├── src/
│   │   │   ├── auth/           # Registro, login, JWT, guards
│   │   │   ├── videos/         # Subida, metadata, estados
│   │   │   ├── config/         # Validación de env (Zod)
│   │   │   ├── health/         # GET /health (Terminus)
│   │   │   ├── app.module.ts   # Módulo raíz
│   │   │   ├── app.setup.ts    # Configuración global (pipes, cookies)
│   │   │   └── main.ts         # Bootstrap + Swagger
│   │   ├── test/               # Tests e2e (Jest + Supertest)
│   │   └── Dockerfile
│   └── worker/                 # Consumidor BullMQ (pipeline IA)
├── libs/
│   ├── prisma/                 # PrismaService compartido
│   └── storage/                # SDK S3 (R2/MinIO), firma de URLs
├── prisma/
│   ├── schema.prisma           # Modelo de datos (fuente de verdad)
│   ├── migrations/             # Migraciones versionadas
│   └── seed.ts                 # Semilla de admin
├── specs/                      # 📋 Spec-driven development
│   ├── spec.md                 # Qué y por qué (historias de usuario)
│   ├── plan.md                 # Cómo (arquitectura, decisiones)
│   └── tasks.md                # Cuándo (fases F0–F8)
├── scripts/
│   └── upload-demo.mjs         # Script de demo de subida
├── docker-compose.yml          # Entorno dev completo
├── .github/workflows/ci.yml   # CI: lint + build
└── CHANGELOG.md                # Keep a Changelog format
```

---

## 📡 API Reference

> Documentación interactiva completa en **Swagger**: [`http://localhost:3000/docs`](http://localhost:3000/docs)

### Endpoints implementados (v0.2.0)

| Método | Ruta | Auth | Descripción |
|---|---|:---:|---|
| `GET` | `/health` | ❌ | Health check con ping a BD |
| `POST` | `/auth/register` | ❌ | Registro con email + contraseña |
| `POST` | `/auth/login` | ❌ | Login → access token + refresh cookie |
| `POST` | `/auth/refresh` | 🍪 | Rota refresh token, emite nuevo access |
| `POST` | `/videos` | 🔒 UPLOADER | Inicia subida → URL prefirmada |
| `POST` | `/videos/:id/confirm` | 🔒 UPLOADER | Confirma subida exitosa |
| `GET` | `/videos/my` | 🔒 UPLOADER | Lista videos propios |
| `DELETE` | `/videos/:id` | 🔒 Owner | Elimina video propio |

### Próximos endpoints (por fase)

<details>
<summary>📋 Ver endpoints planificados (F3–F6)</summary>

| Fase | Método | Ruta | Descripción |
|---|---|---|---|
| F3 | `GET` | `/videos` | Catálogo público (filtros, orden) |
| F3 | `GET` | `/videos/:id` | Detalle de video |
| F3 | `GET` | `/videos/:id/stream` | URL prefirmada para streaming |
| F3 | `POST` | `/videos/:id/publish` | Publicar video |
| F5 | `GET` | `/search?q=&mode=` | Búsqueda texto / semántica |
| F6 | `PUT` | `/videos/:id/favorite` | Toggle favorito |
| F6 | `PUT` | `/videos/:id/progress` | Guardar progreso de reproducción |
| F6 | `PATCH` | `/admin/videos/:id/hide` | Ocultar video (admin) |

</details>

---

## 🗃️ Modelo de datos

```prisma
enum Role        { VIEWER | UPLOADER | ADMIN }
enum VideoStatus { UPLOADING | PROCESSING | READY | PUBLISHED | HIDDEN | FAILED }

User          ──┐
  id, email,    │ 1:N
  password,     │
  role          │
                ▼
Video         ──── storageKey → MinIO/R2
  title, description,
  status, sizeBytes
  synopsis*, categories*, tags*,     ← generados por IA (F5)
  embedding vector(1024)*            ← pgvector (F5)
  transcript*                        ← faster-whisper (F4)
```

---

## 🧪 Testing

```bash
# Tests e2e (requiere infra de test — docker compose up -d db minio)
pnpm test:e2e
```

Los tests e2e actuales cubren:
- ✅ Registro de usuario y validaciones
- ✅ Login y emisión de tokens
- ✅ Refresh token con rotación
- ✅ Guards: `401` sin token, `403` con rol insuficiente
- ✅ Subida de videos: flujo presigned URL + confirm
- ✅ Control de acceso por ownership

---

## 🗺️ Roadmap

> Cada fase termina en algo **demostrable**. No se empieza una fase sin cerrar la anterior.

| Fase | Hito | Release | Estado |
|:---:|---|---|:---:|
| **F0** | Entorno reproducible: `docker compose up` + health + Swagger | `v0.1.0` | ✅ |
| **F1** | Auth JWT completa + roles + guards + tests e2e | `v0.2.0` | ✅ |
| **F2** | Subida de videos a R2/MinIO con URLs prefirmadas | `v0.3.0` | ✅ |
| **F3** | Catálogo público + streaming con seek (`206`) | `v0.4.0` | ⬜ |
| **F4** | Pipeline de transcripción automática (faster-whisper) | `v0.5.0` | ⬜ |
| **F5** | Metadata IA + búsqueda semántica (pgvector) | `v0.6.0` | ⬜ |
| **F6** | Favoritos, historial de reproducción, panel admin | `v0.7.0` | ⬜ |
| **F7** | Frontend Astro completo con islas interactivas | `v0.8.0` | ⬜ |
| **F8** | Deploy a producción + 10 videos demo + URL pública | `v1.0.0` | ⬜ |

---

## 🧰 Scripts disponibles

| Comando | Descripción |
|---|---|
| `docker compose up` | Levanta todo el entorno de desarrollo |
| `pnpm start:api` | API con hot reload |
| `pnpm start:worker` | Worker BullMQ |
| `pnpm build` | Compila `api` + `worker` a `dist/` |
| `pnpm lint` | ESLint (type-checked) |
| `pnpm format` | Prettier |
| `pnpm prisma:generate` | Genera cliente Prisma |
| `pnpm prisma:migrate` | Crea/aplica migraciones |
| `pnpm prisma:seed` | Semilla de usuario admin |
| `pnpm test:e2e` | Tests end-to-end |

---

## 🏗️ Producción (costo $0)

| Pieza | Servicio | Costo |
|---|---|---|
| API + Worker + BD + Redis + IA | Oracle Cloud Always Free (ARM, 4 OCPU / 24 GB RAM) | **$0** |
| Almacenamiento de video | Cloudflare R2 free tier (10 GB, egress ilimitado) | **$0** |
| Frontend | Cloudflare Pages | **$0** |
| Dominio | DuckDNS (subdominio gratuito) + HTTPS con Caddy | **$0** |
| IA (transcripción + LLM + embeddings) | Whisper + Ollama en el VPS — sin API keys | **$0** |
| CI + repositorio | GitHub Free | **$0** |

---

## 📚 Documentación

| Documento | Contenido |
|---|---|
| [`specs/spec.md`](specs/spec.md) | **Qué y por qué**: historias de usuario, criterios de aceptación, scope |
| [`specs/plan.md`](specs/plan.md) | **Cómo**: arquitectura, stack, justificación de cada decisión técnica |
| [`specs/tasks.md`](specs/tasks.md) | **Cuándo**: fases F0–F8, progreso actual |
| [`CHANGELOG.md`](CHANGELOG.md) | Historial de cambios (Keep a Changelog) |
| [`AGENTS.md`](AGENTS.md) | Guía para agentes de IA que trabajen en el repo |
| [Swagger `/docs`](http://localhost:3000/docs) | Documentación interactiva de la API |

---

## 🤝 Contribuciones

Este es un proyecto de portafolio personal, pero los issues y sugerencias son bienvenidos.

**Convenciones del proyecto:**
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`)
- **Comentarios:** En español, explican el *por qué* de cada decisión (estilo educativo)
- **Atajos conocidos:** Marcados con `DEUDA:` y la fase donde se resolverán
- **Versionado:** [SemVer](https://semver.org/) con tags anotados + GitHub Releases

---

<div align="center">

Hecho con ☕ y la convicción de que un proyecto terminado vale más que uno ambicioso a medias.

**[⬆ Volver arriba](#-libreplay)**

</div>
