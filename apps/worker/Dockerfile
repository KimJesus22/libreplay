# Dockerfile de DESARROLLO del worker (F4) — gemelo del de la API.
#
# DEUDA (F8): igual que la API, en prod toca un multi-stage build (builder con
# nest build → runtime solo con dist/ y deps de producción).

FROM node:22-alpine

# ffmpeg: el worker extrae el audio del MP4 antes de mandarlo a whisper
# (apps/worker/src/transcription/ffmpeg.ts). Es la única dependencia de sistema
# que la API no necesita — por eso el worker tiene su propio Dockerfile.
RUN apk add --no-cache ffmpeg

# corepack activa la versión exacta de pnpm del package.json.
RUN corepack enable

WORKDIR /app

# Manifests primero para cachear la capa de install.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# El código real llega por el volumen del compose; este COPY deja la imagen
# usable también sin volumen (CI).
COPY . .

# Cliente Prisma tipado (escribe en node_modules, dentro del volumen anónimo).
RUN pnpm prisma generate

# nest start --watch: recompila el worker al editar los .ts montados.
CMD ["pnpm", "run", "start:worker"]
