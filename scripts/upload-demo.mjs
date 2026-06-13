// Cliente de demo de F2 (tasks.md): sube un MP4 real por el flujo completo
// login → POST /videos → PUT a la URL prefirmada (con progreso) → /confirm.
// Es el mismo flujo que hará la isla de subida del frontend en F7; aquí en
// Node para poder demostrar F2 sin frontend.
//
// Uso:
//   node scripts/upload-demo.mjs <ruta-al.mp4> [titulo]
//   (env opcionales: API_URL, UPLOAD_EMAIL, UPLOAD_PASSWORD — por defecto
//    usa el admin de la semilla, que tiene rol suficiente para subir)
import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';

const API = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.UPLOAD_EMAIL ?? 'admin@libreplay.local';
const PASSWORD = process.env.UPLOAD_PASSWORD ?? 'admin-cambiame';

const [, , filePath, customTitle] = process.argv;
if (!filePath) {
  console.error('Uso: node scripts/upload-demo.mjs <ruta-al.mp4> [titulo]');
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

const sizeBytes = statSync(filePath).size;
const fileName = basename(filePath);

// 1. Login (la semilla admin puede subir; un uploader real también).
const { accessToken } = await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
console.log(`✔ Login como ${EMAIL}`);

// 2. Registrar la subida: la API valida (MP4, límite) y firma la URL PUT.
const auth = { Authorization: `Bearer ${accessToken}` };
const { video, upload } = await api('/videos', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({
    title: customTitle ?? fileName,
    fileName,
    sizeBytes,
  }),
});
console.log(`✔ Video registrado: ${video.id} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB)`);

// 3. PUT directo al storage con progreso. Node no tiene el evento
// xhr.upload.onprogress del navegador; el equivalente es contar los bytes
// del stream a medida que fetch los consume — mismo dato, otra fuente.
let sent = 0;
const fileStream = createReadStream(filePath);
const progressStream = new ReadableStream({
  async start(controller) {
    for await (const chunk of fileStream) {
      sent += chunk.length;
      const pct = ((sent / sizeBytes) * 100).toFixed(0);
      process.stdout.write(`\r  Subiendo... ${pct}% (${sent}/${sizeBytes} bytes)`);
      controller.enqueue(chunk);
    }
    controller.close();
  },
});

const putRes = await fetch(upload.url, {
  method: upload.method,
  // Los headers firmados son obligatorios: otro Content-Type/Length → 403.
  headers: { ...upload.headers, 'Content-Length': String(sizeBytes) },
  body: progressStream,
  duplex: 'half', // requerido por fetch para bodies en streaming
});
process.stdout.write('\n');
if (!putRes.ok) {
  throw new Error(`PUT al storage → ${putRes.status}: ${await putRes.text()}`);
}
console.log('✔ Archivo subido al storage');

// 4. Confirmar: la API verifica el objeto real y marca READY.
const confirmed = await api(`/videos/${video.id}/confirm`, {
  method: 'POST',
  headers: auth,
});
console.log(`✔ Confirmado — estado: ${confirmed.status}`);
console.log(`  Verifícalo en MinIO: http://localhost:9001 → bucket "videos" → ${video.storageKey}`);
