# Tasks — LibrePlay

> Fases de implementación. Cada fase termina en algo **demostrable**; no se empieza una fase sin cerrar la anterior.
> Referencias: historias (`HU-xx`) y criterios (`§6.x`) de `spec.md`; decisiones técnicas en `plan.md`.

## Fase 0 — Fundaciones (entorno reproducible)

- [ ] Monorepo NestJS (`apps/api`, `apps/worker`, `libs/`), TypeScript estricto, ESLint + Prettier
- [ ] `docker-compose.yml`: db (pgvector), redis, minio, api, worker — `docker compose up` levanta todo (§6.5)
- [ ] Prisma conectado, migración inicial vacía + extensión `vector` habilitada
- [ ] `.env.example`, README esqueleto, Swagger en `/docs`
- [ ] CI mínima (GitHub Actions: lint + build)

**Demo:** `docker compose up` → API responde `GET /health`, Swagger visible.

## Fase 1 — Auth y usuarios (HU-01, HU-02)

- [ ] Modelos `User` + roles, hash argon2
- [ ] `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh` (refresh rotativo, cookie httpOnly)
- [ ] `JwtAuthGuard` + `RolesGuard`; semilla de usuario admin
- [ ] Tests e2e: sin token → `401`; viewer en endpoint de uploader → `403` (§6.4)

**Demo:** registro + login desde Swagger, sesión persiste tras refresh.

## Fase 2 — Subida de videos (HU-03)

- [ ] Modelo `Video` + estados; lib `storage` (SDK S3 → MinIO/R2)
- [ ] Flujo presigned PUT: `POST /videos` valida MP4 ≤ 500 MB y devuelve URL; confirmación de subida
- [ ] `PATCH /videos/:id` (título/descripción), `DELETE` propio
- [ ] Progreso de subida en cliente (XHR sobre presigned URL)

**Demo:** subir un MP4 real desde un script/cliente y verlo en MinIO.

## Fase 3 — Catálogo y streaming (HU-05, HU-06)

- [ ] `GET /videos` público con filtro por categoría y orden recientes/populares
- [ ] `GET /videos/:id/stream` → URL prefirmada; verificación de `206 Partial Content` con header `Range` (§6.1)
- [ ] `POST /videos/:id/publish` y contador de vistas
- [ ] Test e2e: petición con `Range` recibe `206`

**Demo:** reproducir y hacer seek en un video desde el navegador.

## Fase 4 — Pipeline de transcripción

- [ ] Contenedor `whisper` (faster-whisper `small` + endpoint HTTP)
- [ ] Worker BullMQ: job `transcribe` (ffmpeg extrae audio → whisper → tabla `Transcript`)
- [ ] Reintentos con backoff; fallo → video publicable manualmente (§6.2)
- [ ] Medir: video de 5 min transcrito en < 5 min (§6.2)

**Demo:** subir video → transcripción aparece en BD sin intervención.

## Fase 5 — Metadata IA y búsqueda (HU-04, HU-07)

- [ ] Job `metadata`: Claude (`claude-opus-4-8`, structured outputs) → sinopsis, categorías, tags sugeridos
- [ ] Job `embed`: Voyage → `embedding` en pgvector + índice HNSW
- [ ] Flujo de revisión del uploader: editar sugerencias antes de publicar (HU-04)
- [ ] `GET /search`: modo texto (tsvector) y modo semántico (coseno + umbral) (§6.3)

**Demo:** buscar "robot que aprende a sentir" encuentra el video correcto sin coincidencia de título.

## Fase 6 — Favoritos, historial y admin (HU-08, HU-09, HU-10)

- [ ] `PUT /videos/:id/favorite` + listado en perfil
- [ ] `PUT /videos/:id/progress` (posición de reproducción) + "continuar viendo"
- [ ] `PATCH /admin/videos/:id/hide` (rol admin)

**Demo:** cerrar el navegador y retomar el video en el mismo minuto.

## Fase 7 — Frontend

- [ ] Sitio Astro + TypeScript + Tailwind CSS (es-ES, estructura i18n-ready §7)
- [ ] Páginas: home/catálogo, detalle+player, búsqueda, login/registro, perfil, subida (uploader), panel admin
- [ ] Islas interactivas (player, búsqueda, formulario de subida con progreso); el resto, HTML estático/SSR
- [ ] Player `<video>` con reanudación de progreso

**Demo:** flujo completo visitante → registro → reproducir → favorito.

## Fase 8 — Producción y métricas de éxito (§8)

- [ ] Deploy: VPS con compose (api, worker, db, redis, whisper) + R2 real + frontend en Cloudflare Pages
- [ ] HTTPS (Caddy/Traefik), dominio, Swagger público en `/docs` (§8.3)
- [ ] 10 videos demo cargados y catalogados por el pipeline (§8.1)
- [ ] README final: GIF demo + diagrama de arquitectura (§8.2)
- [ ] Repaso oral: explicar cada módulo sin leer código (§8.4)

**Demo:** URL pública funcionando de punta a punta.
