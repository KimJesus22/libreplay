# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

LibrePlay — a free video streaming platform (portfolio project). Backend-first rebuild of a React + Supabase app, now with its own NestJS backend, an AI pipeline that auto-catalogs uploaded videos, and an Astro frontend. UI language and all spec documents are Spanish.

The repo follows spec-driven development. Implementation is in **phase F0** (foundations): the NestJS monorepo scaffold exists (`apps/api` with `/health` + Swagger, `apps/worker` placeholder, `libs/prisma`), with Prisma + pgvector wired and CI in place.

## Spec-driven workflow

Three documents in `specs/` govern all work — read them before implementing anything:

- `specs/spec.md` — **what & why**: user stories (HU-01…HU-10), acceptance criteria (§6), scope boundaries. Never put technical decisions here.
- `specs/plan.md` — **how**: architecture, stack choices with their justifications, data model, pipeline design. Every decision must be defensible in a job interview — when adding or changing a decision, record the "why (and not the alternative)".
- `specs/tasks.md` — **when**: phases F0–F8, each ending in a verifiable demo. Do not start a phase before the previous one is closed; check off tasks as they complete.

Out-of-scope items (spec §3) are deliberate: no transcoding/HLS, no DRM, no CDN, no mobile apps, no monetization, no comments. Don't add them.

## Architecture (from plan.md — the constraints to honor)

Monorepo with two NestJS Node processes plus an Astro site:

- `apps/api` — synchronous HTTP: auth (JWT access 15min + rotating refresh in httpOnly cookie, argon2 hashes, roles VIEWER/UPLOADER/ADMIN), catalog, search, favorites/history, presigned URL issuance.
- `apps/worker` — BullMQ consumer running the AI pipeline as three chained jobs: `transcribe` (ffmpeg → faster-whisper container) → `metadata` (local LLM via Ollama `qwen2.5:3b-instruct` behind a `MetadataGenerator` port, schema-forced JSON validated with Zod; an optional Claude adapter exists behind `METADATA_PROVIDER=claude`) → `embed` (Ollama `bge-m3`, 1024-dim multilingual → pgvector).
- `apps/web` — **Astro + TypeScript + Tailwind CSS** consuming the REST API. Islands architecture: only the player, search, and upload form hydrate as interactive islands (vanilla TS / Astro components — no React or other UI framework); everything else ships as static/SSR HTML.
- Shared code in `libs/` (`prisma`, `storage`, `queue`).

Load-bearing decisions:

- **Video bytes never pass through the API.** `GET /videos/:id/stream` returns a presigned R2 URL; the browser's `<video>` element sends `Range` requests directly to R2 (must yield `206 Partial Content` — acceptance criterion §6.1).
- **AI pipeline failure must not block publishing.** On total pipeline failure the video becomes `READY` with empty AI fields and is manually publishable (§6.2).
- **One database for everything.** PostgreSQL 16 with pgvector (`pgvector/pgvector:pg16` image). Embeddings use `Unsupported("vector(1024)")` in Prisma and `$queryRaw` with the `<=>` cosine operator for semantic search; HNSW index is created in a manual SQL migration.
- **Hard $0-cost constraint.** No piece of the stack may generate a bill: no paid APIs, no metered AI services. All AI runs locally (faster-whisper + Ollama in the compose); hosting targets are Oracle Cloud Always Free, Cloudflare R2 free tier, Cloudflare Pages, DuckDNS. Before adding any external service, verify it is genuinely free (see `plan.md` §7).
- **Local dev uses MinIO as the R2 stand-in** (same S3 SDK); production uses real Cloudflare R2 free tier. `docker compose up` must bring up the entire dev environment (db, redis, minio, whisper, ollama, api, worker) — acceptance criterion §6.5.
- The AI stack needs no API keys. The only secrets are R2 keys (production only) and the JWT secret, in `.env` (gitignored); keep `.env.example` current when adding variables.

## Releases

SemVer with annotated tags + GitHub Releases; version-per-phase map lives in `specs/plan.md` §9 (`v0.1.0` at F0 … `v1.0.0` when F8 closes). Closing a phase means: demo verified → update `CHANGELOG.md` (Keep a Changelog format) → `git tag -a vX.Y.Z` → push tag → GitHub Release. Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`…). Pre-1.0, breaking API changes are allowed without a major bump.

## Commands

- `docker compose up` — full dev environment (db + redis + minio + api with hot reload; applies Prisma migrations on boot). API: `http://localhost:3000/health`, Swagger: `/docs`.
- `pnpm install` then `pnpm prisma:generate` — first-time setup outside Docker (Node ≥ 22).
- `pnpm lint` / `pnpm format` — ESLint (type-checked) / Prettier.
- `pnpm build` — compiles `api` and `worker` to `dist/`.
- `pnpm start:api` / `pnpm start:worker` — watch mode outside Docker (need Postgres/Redis running).
- `pnpm prisma:migrate` — create/apply a migration in dev (`prisma migrate dev`).

No tests yet — e2e tests arrive in F1; add the command here when they do.

## Code style

Comments are educational and in Spanish: they explain the *why* of each decision (often citing `plan.md`/`spec.md` sections) as if defending it in a job interview. Known shortcuts are marked `DEUDA:` with the phase where they'll be paid. Match this style when adding code.
