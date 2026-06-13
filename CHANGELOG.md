# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).
El mapa de versiones por fase vive en `specs/plan.md` §9.

## [Unreleased]

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
