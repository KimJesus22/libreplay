// Demo de F4 (tasks.md): demuestra el pipeline de transcripción de punta a
// punta SIN intervención manual. Sube un MP4 real, lo confirma (la API encola
// el job `transcribe` y deja el video en PROCESSING) y luego SONDEA la BD hasta
// que el worker guarda el Transcript y devuelve el video a READY — cronometrando
// el total para el criterio §6.2 (5 min de video transcrito en < 5 min).
//
// Requisitos: el stack completo arriba con `docker compose up` (db, redis,
// minio, whisper, worker, api). El MP4 debe tener AUDIO CON VOZ para que haya
// algo que transcribir.
//
// Uso:
//   node scripts/pipeline-demo.mjs <ruta-al.mp4> [titulo]
//   (env opcionales: API_URL, DATABASE_URL, UPLOAD_EMAIL, UPLOAD_PASSWORD)
import 'dotenv/config';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.UPLOAD_EMAIL ?? 'admin@libreplay.local';
const PASSWORD = process.env.UPLOAD_PASSWORD ?? 'admin-cambiame';
// Tope de espera del polling: holgado para modelos en CPU (el criterio es 5 min
// de VIDEO < 5 min, no un tope duro). Configurable por si el host es lento.
const TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS ?? 15 * 60 * 1000);
const POLL_MS = 3000;

const [, , filePath, customTitle] = process.argv;
if (!filePath) {
  console.error('Uso: node scripts/pipeline-demo.mjs <ruta-al.mp4> [titulo]');
  process.exit(1);
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sizeBytes = statSync(filePath).size;
const fileName = basename(filePath);
const prisma = new PrismaClient();

try {
  // 1. Login (la semilla admin tiene rol suficiente para subir).
  const { accessToken } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = { Authorization: `Bearer ${accessToken}` };
  console.log(`✔ Login como ${EMAIL}`);

  // 2. Registrar la subida y firmar la URL PUT.
  const { video, upload } = await api('/videos', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ title: customTitle ?? fileName, fileName, sizeBytes }),
  });
  console.log(`✔ Video registrado: ${video.id} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

  // 3. PUT directo al storage.
  const putRes = await fetch(upload.url, {
    method: upload.method,
    headers: { ...upload.headers, 'Content-Length': String(sizeBytes) },
    body: createReadStream(filePath),
    duplex: 'half',
  });
  if (!putRes.ok) throw new Error(`PUT al storage → ${putRes.status}: ${await putRes.text()}`);
  console.log('✔ Archivo subido al storage');

  // 4. Confirmar: la API encola `transcribe` y deja el video en PROCESSING.
  const confirmed = await api(`/videos/${video.id}/confirm`, { method: 'POST', headers: auth });
  console.log(`✔ Confirmado — estado: ${confirmed.status} (esperado PROCESSING)`);

  // 5. Sondear la BD hasta que el worker termine. Sin tocar nada más: esto es
  // justo lo que pide el criterio — la transcripción aparece SOLA.
  console.log('⏳ Esperando al worker (transcripción)...');
  const startedAt = Date.now();
  let done = null;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const row = await prisma.video.findUnique({
      where: { id: video.id },
      include: { transcript: true },
    });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    process.stdout.write(`\r  estado=${row.status} transcript=${row.transcript ? 'sí' : 'no'} (${elapsed}s)   `);
    if (row.transcript) {
      done = row;
      break;
    }
    // Si el video volvió a READY sin transcript, el pipeline falló pero el
    // video quedó publicable (spec §6.2): lo reportamos y salimos.
    if (row.status === 'READY' && !row.transcript) {
      done = row;
      break;
    }
    await sleep(POLL_MS);
  }
  process.stdout.write('\n');

  if (!done) {
    throw new Error(`Timeout: el worker no terminó en ${TIMEOUT_MS / 1000}s`);
  }

  const totalS = ((Date.now() - startedAt) / 1000).toFixed(1);
  if (done.transcript) {
    console.log(`✔ Transcripción en BD tras ${totalS}s (sin intervención manual)`);
    console.log(`  idioma: ${done.transcript.language} | duración: ${done.durationS ?? '?'}s | estado: ${done.status}`);
    console.log(`  texto: "${done.transcript.text.slice(0, 280)}${done.transcript.text.length > 280 ? '…' : ''}"`);
  } else {
    console.log(`⚠ El pipeline falló pero el video quedó READY y publicable (spec §6.2) tras ${totalS}s`);
  }
} finally {
  await prisma.$disconnect();
}
