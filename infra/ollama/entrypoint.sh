#!/bin/sh
# Arranque de Ollama con pull de modelos (LibrePlay F5, plan.md §5/§6).
#
# La imagen oficial solo hace `ollama serve` — no trae modelos. Aquí arrancamos
# el servidor en segundo plano, esperamos a que responda y bajamos los dos
# modelos del pipeline ($0, sin API key). Quedan cacheados en el volumen
# /root/.ollama, así que el pull solo ocurre la primera vez (igual que whisper).
set -e

# Modelos configurables por env (mismos defaults que el worker/API).
METADATA_MODEL="${METADATA_MODEL:-qwen2.5:3b-instruct}"
EMBED_MODEL="${EMBED_MODEL:-bge-m3}"

# Servidor en background; guardamos el PID para cederle la terminal al final.
ollama serve &
pid=$!

# Esperar a que la API responda antes de pedir pulls.
echo "Esperando a que Ollama arranque..."
until ollama list >/dev/null 2>&1; do
  sleep 1
done

echo "Descargando modelos (solo la primera vez): $METADATA_MODEL, $EMBED_MODEL"
ollama pull "$METADATA_MODEL"
ollama pull "$EMBED_MODEL"
echo "Modelos listos."

# Cedemos el proceso al servidor: el contenedor vive mientras `ollama serve` viva.
wait "$pid"
