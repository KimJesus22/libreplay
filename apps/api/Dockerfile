# Dockerfile de DESARROLLO: prioriza arrancar rápido y recargar al editar.
#
# DEUDA: para producción (F8) hace falta un multi-stage build:
#   etapa 1 "builder" (npm ci + nest build) → etapa 2 solo con dist/ y
#   dependencias de producción. Imagen final ~10x más pequeña y sin
#   devDependencies. Se paga al preparar el deploy.

FROM node:22-alpine

# corepack lee el campo "packageManager" del package.json y activa la versión
# exacta de pnpm — mismo gestor en tu máquina, en Docker y en CI.
RUN corepack enable

WORKDIR /app

# Copiamos SOLO los manifests primero: Docker cachea capas, así que mientras
# package.json y el lockfile no cambien, "pnpm install" no se repite en cada build.
# (pnpm-workspace.yaml también es manifest: define allowBuilds y los paquetes.)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# El código real llega por el volumen del compose; este COPY solo sirve
# para que la imagen también funcione sin volumen (CI, por ejemplo).
COPY . .

# Genera el cliente Prisma tipado a partir del schema (que llegó con el COPY
# anterior). Escribe en node_modules → queda dentro del volumen anónimo que
# el compose preserva en runtime.
RUN pnpm prisma generate

EXPOSE 3000

# nest start --watch: recompila al detectar cambios en los .ts montados.
CMD ["pnpm", "run", "start:api"]
