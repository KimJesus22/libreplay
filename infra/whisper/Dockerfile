# Contenedor de transcripción: faster-whisper tras una API HTTP (F4, plan.md §6).
#
# python:3.11-slim: base ligera con Python; faster-whisper trae sus binarios
# (CTranslate2) por pip, sin compilar nada nativo a mano.
FROM python:3.11-slim

WORKDIR /app

# Primero requirements para cachear la capa de pip mientras no cambien.
# (Contexto de build = infra/whisper, ver docker-compose.yml.)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# El modelo se descarga del Hub la primera vez que arranca y queda en el cache
# del contenedor. Pre-descargarlo en build dejaría la imagen enorme; mejor en
# el primer arranque (el healthcheck del compose espera a que esté listo).
COPY app.py ./

EXPOSE 8081

# uvicorn sirve la app FastAPI. Un solo worker: el modelo ocupa RAM y la
# transcripción es CPU-bound; varios workers competirían por la CPU sin ganar.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8081"]
