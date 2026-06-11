# LibrePlay

Plataforma libre de streaming de video con catalogación automática por IA — proyecto de portafolio con **restricción dura de costo $0**: todo el stack (transcripción, LLM, embeddings, hosting) corre en servicios gratuitos o locales.

> 🚧 En construcción — Fase 0 de 8. El plan completo vive en [`specs/`](specs/).

## Qué hace (cuando esté completo)

Subes un MP4 y el pipeline de IA lo cataloga solo: transcribe el audio (faster-whisper), genera sinopsis/categorías/tags (LLM local vía Ollama) y crea embeddings para búsqueda semántica (pgvector). Buscar *"robot que aprende a sentir"* encuentra el video correcto aunque el título no coincida.

## Stack

| Capa | Tecnología |
|---|---|
| API | NestJS + Prisma + PostgreSQL 16 (pgvector) |
| Pipeline IA | Worker NestJS + BullMQ (Redis) → faster-whisper + Ollama (`qwen2.5:3b-instruct`, `bge-m3`) |
| Almacenamiento | Cloudflare R2 (MinIO en dev) — el video viaja por URLs prefirmadas, nunca por la API |
| Frontend | Astro + TypeScript + Tailwind CSS (islas interactivas) |

## Desarrollo

Requisitos: Docker. Eso es todo — no hay API keys que conseguir.

```bash
cp .env.example .env
docker compose up
```

- API: <http://localhost:3000/health>
- Swagger: <http://localhost:3000/docs>
- Consola MinIO: <http://localhost:9001>

Sin Docker (necesita Node ≥ 22 + pnpm, y Postgres/Redis propios):

```bash
pnpm install
pnpm prisma:generate
pnpm start:api      # API con recarga en caliente
pnpm start:worker   # worker (vacío hasta F4)
pnpm lint           # ESLint
pnpm build          # compila api + worker
```

## Documentación

- [`specs/spec.md`](specs/spec.md) — historias de usuario y criterios de aceptación
- [`specs/plan.md`](specs/plan.md) — arquitectura y justificación de cada decisión
- [`specs/tasks.md`](specs/tasks.md) — fases F0–F8 y estado actual
- [`AGENTS.md`](AGENTS.md) — guía para agentes de IA que trabajen en el repo

<!-- DEUDA (F8): GIF demo + diagrama de arquitectura (métrica §8.2) -->
