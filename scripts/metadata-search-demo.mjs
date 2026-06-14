// Demo de F5 (tasks.md): demuestra el pipeline IA COMPLETO + la búsqueda
// semántica de punta a punta. Sube un MP4 con voz, espera a que el worker
// genere transcripción + metadata (sinopsis/categorías/tags) + embedding SIN
// intervención manual, publica el video y comprueba que `GET /search` en modo
// semántico lo encuentra a partir de una frase que NO coincide con su título.
//
// Requisitos: el stack completo arriba con `docker compose up` (incluye ollama,
// con los modelos ya descargados). El MP4 debe tener AUDIO CON VOZ.
//
// Uso:
//   node scripts/metadata-search-demo.mjs <ruta-al.mp4> [titulo] [queryDeBusqueda]
//   (env opcionales: API_URL, DATABASE_URL, UPLOAD_EMAIL, UPLOAD_PASSWORD)
import 'dotenv/config';
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.UPLOAD_EMAIL ?? 'admin@libreplay.local';
const PASSWORD = process.env.UPLOAD_PASSWORD ?? 'admin-cambiame';
const TIMEOUT_MS = Number(process.env.PIPELINE_TIMEOUT_MS ?? 15 * 60 * 1000);
const POLL_MS = 3000;

const [, , filePath, customTitle, customQuery] = process.argv;
if (!filePath) {
  console.error('Uso: node scripts/metadata-search-demo.mjs <ruta-al.mp4> [titulo] [query]');
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

  // 4. Confirmar: arranca el pipeline (transcribe → metadata → embed).
  const confirmed = await api(`/videos/${video.id}/confirm`, { method: 'POST', headers: auth });
  console.log(`✔ Confirmado — estado: ${confirmed.status} (esperado PROCESSING)`);

  // 5. Sondear hasta que el pipeline COMPLETO termine: el video vuelve a READY
  // y trae sinopsis + embedding. embedding es Unsupported en Prisma → se
  // consulta con SQL crudo.
  console.log('⏳ Esperando al worker (transcripción → metadata → embedding)...');
  const startedAt = Date.now();
  let done = null;
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const row = await prisma.video.findUnique({
      where: { id: video.id },
      include: { transcript: true },
    });
    const [{ has_embedding: hasEmbedding }] = await prisma.$queryRaw`
      SELECT embedding IS NOT NULL AS has_embedding FROM "Video" WHERE id = ${video.id}`;
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    process.stdout.write(
      `\r  estado=${row.status} transcript=${row.transcript ? 'sí' : 'no'} ` +
        `synopsis=${row.synopsis ? 'sí' : 'no'} embedding=${hasEmbedding ? 'sí' : 'no'} (${elapsed}s)   `,
    );
    // READY es el estado terminal: el pipeline acabó (con o sin cada campo IA).
    if (row.status === 'READY') {
      done = { ...row, hasEmbedding };
      break;
    }
    await sleep(POLL_MS);
  }
  process.stdout.write('\n');
  if (!done) throw new Error(`Timeout: el worker no terminó en ${TIMEOUT_MS / 1000}s`);

  const totalS = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`✔ Pipeline completo en ${totalS}s (sin intervención manual)`);
  console.log(`  categorías: ${done.categories.join(', ') || '—'} | tags: ${done.tags.join(', ') || '—'}`);
  console.log(`  sinopsis: "${(done.synopsis ?? '(no generada)').slice(0, 280)}"`);
  console.log(`  embedding: ${done.hasEmbedding ? 'guardado (búsqueda semántica disponible)' : 'ausente (solo búsqueda textual)'}`);

  // 6. Publicar (en real lo hace el uploader tras revisar — HU-04).
  await api(`/videos/${video.id}/publish`, { method: 'POST', headers: auth });
  console.log('✔ Video publicado');

  // 7. Buscar SEMÁNTICAMENTE con una frase que no comparte palabras con el
  // título: el objetivo demostrable de la fase (tasks.md §F5).
  const query = customQuery ?? 'una historia sobre inteligencia artificial y emociones';
  const found = await api(`/search?mode=semantic&q=${encodeURIComponent(query)}`);
  const hit = found.items.find((v) => v.id === video.id);
  console.log(`\n🔎 Búsqueda semántica: "${query}"`);
  console.log(`  ${found.items.length} resultado(s); el video subido ${hit ? 'APARECE ✓' : 'NO aparece ✗'}`);
  if (!hit) {
    console.log('  (ajusta la query o revisa que el embedding se haya generado)');
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
