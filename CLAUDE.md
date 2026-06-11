# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

LibrePlay — a free video streaming platform (portfolio project). Backend-first rebuild of a React + Supabase app, now with its own NestJS backend and an AI pipeline that auto-catalogs uploaded videos. UI language and all spec documents are Spanish.

**There is no application code yet.** The repo follows spec-driven development; implementation has not started.

## Spec-driven workflow

Three documents in `specs/` govern all work — read them before implementing anything:

- `specs/spec.md` — **what & why**: user stories (HU-01…HU-10), acceptance criteria (§6), scope boundaries. Never put technical decisions here.
- `specs/plan.md` — **how**: architecture, stack choices with their justifications, data model, pipeline design. Every decision must be defensible in a job interview — when adding or changing a decision, record the "why (and not the alternative)".
- `specs/tasks.md` — **when**: phases F0–F8, each ending in a verifiable demo. Do not start a phase before the previous one is closed; check off tasks as they complete.

Out-of-scope items (spec §3) are deliberate: no transcoding/HLS, no DRM, no CDN, no mobile apps, no monetization, no comments. Don't add them.

## Architecture (from plan.md — the constraints to honor)

Monorepo NestJS with two Node processes from the same codebase:

- `apps/api` — synchronous HTTP: auth (JWT access 15min + rotating refresh in httpOnly cookie, argon2 hashes, roles VIEWER/UPLOADER/ADMIN), catalog, search, favorites/history, presigned URL issuance.
- `apps/worker` — BullMQ consumer running the AI pipeline as three chained jobs: `transcribe` (ffmpeg → faster-whisper container) → `metadata` (Claude `claude-opus-4-8` via `@anthropic-ai/sdk`, structured outputs with Zod schema) → `embed` (Voyage AI `voyage-3.5-lite` → pgvector).
- Shared code in `libs/` (`prisma`, `storage`, `queue`).

Load-bearing decisions:

- **Video bytes never pass through the API.** `GET /videos/:id/stream` returns a presigned R2 URL; the browser's `<video>` element sends `Range` requests directly to R2 (must yield `206 Partial Content` — acceptance criterion §6.1).
- **AI pipeline failure must not block publishing.** On total pipeline failure the video becomes `READY` with empty AI fields and is manually publishable (§6.2).
- **One database for everything.** PostgreSQL 16 with pgvector (`pgvector/pgvector:pg16` image). Embeddings use `Unsupported("vector(1024)")` in Prisma and `$queryRaw` with the `<=>` cosine operator for semantic search; HNSW index is created in a manual SQL migration.
- **Local dev uses MinIO as the R2 stand-in** (same S3 SDK); production uses real Cloudflare R2. `docker compose up` must bring up the entire dev environment (db, redis, minio, whisper, api, worker) — acceptance criterion §6.5.
- Secrets (`ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, R2 keys) live in `.env` (gitignored); keep `.env.example` current when adding variables.

## Commands

No build/test tooling exists yet. Once F0 lands, the entry point is `docker compose up` (full dev environment) — keep this CLAUDE.md updated with real lint/test/run commands as they are introduced.
