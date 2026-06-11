# Spec — LibrePlay

> Documento de **qué** construimos y **por qué**. No contiene decisiones técnicas (eso vive en `plan.md`).
> Estado: v1 — 2026-06-10

## 1. Visión

Plataforma web gratuita de streaming de video, inspirada en Mercado Play. Es la reconstrucción de un proyecto anterior (React + Supabase), ahora con **backend propio** y un **pipeline de IA** que cataloga el contenido automáticamente.

**Objetivo del autor:** proyecto de portafolio para conseguir el primer empleo en TI. Cada decisión debe poder defenderse en una entrevista técnica.

## 2. Objetivos (in scope)

1. Usuarios pueden registrarse, iniciar sesión y mantener un perfil.
2. Usuarios con rol `uploader` pueden subir videos MP4 (H.264) con título y descripción.
3. Cualquier visitante puede explorar el catálogo; usuarios autenticados pueden reproducir.
4. La reproducción soporta **seek** (adelantar/retroceder sin descargar todo el archivo).
5. Al subir un video, un pipeline automático lo **transcribe** y genera **metadata con IA**: sinopsis, categorías y etiquetas sugeridas.
6. Búsqueda en dos modos: por texto (título/descripción) y **semántica** ("película donde un robot aprende a sentir" encuentra el video aunque esas palabras no aparezcan en el título).
7. Favoritos e historial de reproducción por usuario.
8. Todo el entorno de desarrollo corre con Docker (sin instalar bases de datos en la máquina).
9. Desplegado en producción con URL pública.

## 3. No-objetivos (out of scope) — la trampa a evitar

- ❌ Transcodificación de video / HLS adaptativo / múltiples calidades.
- ❌ DRM o protección de contenido.
- ❌ CDN propio.
- ❌ Apps móviles.
- ❌ Monetización, anuncios, suscripciones.
- ❌ Comentarios/reseñas (candidato a v2, no a v1).

Regla: **un proyecto terminado y desplegado vale más que uno ambicioso a medias.**

## 4. Usuarios y roles

| Rol | Puede |
|---|---|
| Visitante (sin cuenta) | Ver catálogo y detalle de videos |
| Usuario (`viewer`) | Lo anterior + reproducir, favoritos, historial, buscar |
| Creador (`uploader`) | Lo anterior + subir y gestionar sus propios videos |
| Admin | Todo + moderar (ocultar/eliminar) cualquier video |

## 5. Historias de usuario (v1)

- **HU-01** Como visitante, quiero registrarme con email y contraseña para tener cuenta.
- **HU-02** Como usuario, quiero iniciar sesión y que mi sesión persista.
- **HU-03** Como creador, quiero subir un MP4 con título y descripción, y ver el progreso de la subida.
- **HU-04** Como creador, quiero que al terminar de subir, el sistema genere automáticamente sinopsis, categorías y etiquetas, y poder editarlas antes de publicar.
- **HU-05** Como usuario, quiero explorar el catálogo por categoría y orden (recientes / populares).
- **HU-06** Como usuario, quiero reproducir un video y poder saltar a cualquier minuto.
- **HU-07** Como usuario, quiero buscar escribiendo lo que recuerdo de la trama, no solo el título exacto.
- **HU-08** Como usuario, quiero marcar favoritos y verlos en mi perfil.
- **HU-09** Como usuario, quiero que la plataforma recuerde en qué minuto dejé un video.
- **HU-10** Como admin, quiero ocultar un video que viole las reglas.

## 6. Criterios de aceptación clave

- **Streaming:** una petición con header `Range: bytes=...` recibe `206 Partial Content`; el seek en el reproductor responde en < 2 s con conexión normal.
- **Pipeline IA:** un video de 5 min queda transcrito y con metadata sugerida en < 5 min después de subirse; si el pipeline falla, el video queda publicable manualmente (la IA es mejora, no bloqueo).
- **Búsqueda semántica:** consultas en lenguaje natural devuelven resultados relevantes ordenados por similitud.
- **Auth:** endpoints protegidos rechazan peticiones sin token válido con `401`; un `viewer` que intenta subir video recibe `403`.
- **Docker:** `docker compose up` levanta todo el entorno de desarrollo en una máquina con solo Docker instalado.

## 7. Restricciones

- Presupuesto: capas gratuitas o de costo casi cero (proyecto de portafolio).
- Videos: solo MP4/H.264, máximo 500 MB por archivo (límite configurable).
- Idioma de la interfaz: español (estructura preparada para i18n futuro).

## 8. Métricas de éxito del proyecto

1. URL pública funcionando con al menos 10 videos de demostración.
2. README con GIF/video demo y diagrama de arquitectura.
3. Documentación de API navegable (Swagger) en línea.
4. El autor puede explicar cada módulo sin leer el código.
