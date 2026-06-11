# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).
El mapa de versiones por fase vive en `specs/plan.md` §9.

## [Unreleased]

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
