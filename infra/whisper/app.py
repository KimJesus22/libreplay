"""API HTTP mínima sobre faster-whisper (LibrePlay F4, plan.md §5).

Por qué un contenedor propio y no una lib en el worker: faster-whisper es
Python y carga un modelo pesado en memoria; aislarlo en su servicio deja el
worker (Node) ligero, permite escalarlo aparte y mantiene el coste en $0
(corre local, sin API key — decisión plan.md §2).

El worker manda el audio ya extraído (WAV 16 kHz mono) por multipart; aquí solo
se transcribe. El modelo se carga UNA vez al arrancar (no por petición): es lo
caro, y así la primera transcripción no paga el arranque del modelo.
"""

import os
import tempfile

from fastapi import FastAPI, UploadFile, File, HTTPException
from faster_whisper import WhisperModel

# Modelo configurable por env; `small` por defecto (plan.md §2: equilibrio
# calidad/velocidad multilingüe). int8 en CPU = menos RAM y más rápido sin GPU,
# suficiente para el criterio de 5 min de video < 5 min (spec §6.2).
MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")

app = FastAPI(title="LibrePlay Whisper", version="1.0.0")


@app.get("/health")
def health():
    # Lo usa el healthcheck del compose: el worker no debe arrancar a mandar
    # audio antes de que el modelo esté cargado.
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    # Volcamos el upload a un archivo temporal: faster-whisper lee de una ruta.
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    try:
        # vad_filter recorta silencios → menos alucinaciones y algo más rápido.
        segments, info = model.transcribe(tmp_path, vad_filter=True)
        # `segments` es un generador perezoso: consumirlo aquí dispara la
        # transcripción real. Concatenamos el texto de todos los segmentos.
        text = "".join(seg.text for seg in segments).strip()
        return {
            "text": text,
            "language": info.language,
            "durationS": info.duration,
        }
    except Exception as exc:  # noqa: BLE001 — devolvemos el error como 500 legible
        raise HTTPException(status_code=500, detail=f"transcripción falló: {exc}")
    finally:
        os.unlink(tmp_path)
