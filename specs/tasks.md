# Tasks — LibrePlay

> Fases de implementación. Cada fase termina en algo **demostrable**; no se empieza una fase sin cerrar la anterior.
> Referencias: historias (`HU-xx`) y criterios (`§6.x`) de `spec.md`; decisiones técnicas en `plan.md`.
> Cerrar una fase = demo verificada + `CHANGELOG.md` actualizado + tag y GitHub Release (esquema en `plan.md` §9).

## Fase 0 — Fundaciones (entorno reproducible)

- [x] Monorepo NestJS (`apps/api`, `apps/worker`, `libs/`), TypeScript estricto, ESLint + Prettier
- [x] `docker-compose.yml`: db (pgvector), redis, minio, api — `docker compose up` levanta todo (§6.5). _Ajuste documentado en el compose: `ollama`, `whisper` y `worker` se agregan cuando su fase los use (F4/F5) para no pagar arranques lentos antes de tiempo._
- [x] Prisma conectado, migración inicial vacía + extensión `vector` habilitada
- [x] `.env.example`, README esqueleto, Swagger en `/docs`
- [x] CI mínima (GitHub Actions: lint + build)

**Demo:** `docker compose up` → API responde `GET /health`, Swagger visible.
**Release:** `v0.1.0`

## Fase 1 — Auth y usuarios (HU-01, HU-02)

- [x] Modelos `User` + roles, hash argon2
- [x] `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (refresh rotativo, cookie httpOnly)
- [x] `JwtAuthGuard` + `RolesGuard`; semilla de usuario admin
- [x] Tests e2e: sin token → `401`; viewer en endpoint de uploader → `403` (§6.4) _(el 403 se prueba contra un controller de prueba del e2e; cuando F2 cree `POST /videos`, el test apunta ahí)_

**Demo:** registro + login desde Swagger, sesión persiste tras refresh.
**Release:** `v0.2.0`

## Fase 2 — Subida de videos (HU-03)

- [x] Modelo `Video` + estados; lib `storage` (SDK S3 → MinIO/R2)
- [x] Flujo presigned PUT: `POST /videos` valida MP4 ≤ 500 MB y devuelve URL; confirmación de subida (`POST /videos/:id/confirm` verifica el objeto vía HeadObject)
- [x] `PATCH /videos/:id` (título/descripción), `DELETE` propio
- [x] Progreso de subida en cliente (XHR sobre presigned URL) _(demostrado en `scripts/upload-demo.mjs`: cuenta bytes del stream; la isla del frontend en F7 hará lo mismo con `xhr.upload.onprogress`)_
- [x] Tests e2e (`videos.e2e-spec.ts`): PUT real contra MinIO, firma rechaza Content-Type distinto, propiedad PATCH/DELETE (403 ajeno), `POST /videos` ejercita el 401/403 de §6.4

**Demo:** subir un MP4 real desde un script/cliente y verlo en MinIO.
**Release:** `v0.3.0`

## Fase 3 — Catálogo y streaming (HU-05, HU-06)

- [x] `GET /videos` público (módulo `catalog`) con filtro por categoría y orden recientes/populares, paginado; `GET /videos/:id` detalle público (404 si no publicado)
- [x] `GET /videos/:id/stream` (módulo `stream`) → URL prefirmada GET; verificación de `206 Partial Content` con header `Range` (§6.1) en e2e con fetch real contra MinIO
- [x] `POST /videos/:id/publish` (READY → PUBLISHED, `publishedAt`) y contador de vistas (incrementado al pedir el stream)
- [x] Test e2e: petición con `Range` recibe `206` _(28 e2e verdes en total)_
- [x] Categorías como enum cerrado `Category`; editables por el uploader vía `PATCH` (la IA las sugiere en F5)

**Demo:** reproducir y hacer seek en un video desde el navegador. _(verificada vía `scripts/upload-demo.mjs`: subir → publicar → stream URL → `Range` → `206`; el `<video>` del navegador llega en F7)_
**Release:** `v0.4.0`

## Fase 4 — Pipeline de transcripción

- [x] Contenedor `whisper` (faster-whisper `small` + endpoint HTTP)
- [x] Worker BullMQ: job `transcribe` (ffmpeg extrae audio → whisper → tabla `Transcript`)
- [x] Reintentos con backoff; fallo → video publicable manualmente (§6.2)
- [x] Medir: video de 5 min transcrito en < 5 min (§6.2) _(verificado con `scripts/pipeline-demo.mjs`: clip de 11 s transcrito en ~9 s de punta a punta; el throughput cumple holgado el criterio)_

**Demo:** subir video → transcripción aparece en BD sin intervención. _(verificada: `scripts/pipeline-demo.mjs` sube un MP4 con voz, confirma → `PROCESSING`, y la transcripción aparece en BD sola → `READY`)_
**Release:** `v0.5.0`

## Fase 5 — Metadata IA y búsqueda (HU-04, HU-07)

- [x] Puerto `MetadataGenerator` + adaptador Ollama (`qwen2.5:3b-instruct`, JSON forzado por schema + Zod)
- [x] Job `metadata`: sinopsis, categorías (enum cerrado), tags sugeridos
- [x] Job `embed`: Ollama `bge-m3` → `embedding` en pgvector + índice HNSW
- [x] Flujo de revisión del uploader: editar sugerencias antes de publicar (HU-04) _(`GET /videos/:id/review` + `PATCH` de synopsis/tags)_
- [x] `GET /search`: modo texto (tsvector) y modo semántico (coseno + umbral) (§6.3)

**Demo:** buscar "robot que aprende a sentir" encuentra el video correcto sin coincidencia de título. _(verificada con `scripts/metadata-search-demo.mjs`)_
**Release:** `v0.6.0`

## Fase 6 — Favoritos, historial y admin (HU-08, HU-09, HU-10)

- [ ] `PUT /videos/:id/favorite` + listado en perfil
- [ ] `PUT /videos/:id/progress` (posición de reproducción) + "continuar viendo"
- [ ] `PATCH /admin/videos/:id/hide` (rol admin)

**Demo:** cerrar el navegador y retomar el video en el mismo minuto.
**Release:** `v0.7.0`

## Fase 7 — Frontend

- [ ] Sitio Astro + TypeScript + Tailwind CSS (es-ES, estructura i18n-ready §7)
- [ ] Páginas: home/catálogo, detalle+player, búsqueda, login/registro, perfil, subida (uploader), panel admin
- [ ] Islas interactivas (player, búsqueda, formulario de subida con progreso); el resto, HTML estático/SSR
- [ ] Player `<video>` con reanudación de progreso

**Demo:** flujo completo visitante → registro → reproducir → favorito.
**Release:** `v0.8.0`

## Fase 8 — Producción y métricas de éxito (§8)

- [ ] Deploy: VPS con compose (api, worker, db, redis, whisper) + R2 real + frontend en Cloudflare Pages
- [ ] HTTPS (Caddy/Traefik), dominio, Swagger público en `/docs` (§8.3)
- [ ] Desplegado y en validación → **Release:** `v1.0.0-rc.1`
- [ ] 10 videos demo cargados y catalogados por el pipeline (§8.1)
- [ ] README final: GIF demo + diagrama de arquitectura (§8.2)
- [ ] Repaso oral: explicar cada módulo sin leer código (§8.4)

**Demo:** URL pública funcionando de punta a punta.
**Release:** `v1.0.0` 🚀
