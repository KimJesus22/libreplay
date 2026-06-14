// Tests e2e de F2 (HU-03): flujo completo de subida por presigned PUT,
// validaciones de MP4/límite y propiedad (PATCH/DELETE solo del dueño).
//
// Requisitos: `docker compose up -d db minio redis` y `.env` con DATABASE_URL,
// JWT_SECRET, REDIS_URL y S3_*. El PUT va contra MinIO REAL: probar la subida
// con el storage mockeado dejaría sin cubrir justo lo crítico (firma de headers,
// verificación del objeto en /confirm). Redis hace falta desde F4: /confirm
// encola el job `transcribe` (no hay worker en el e2e; el job queda en cola).
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@app/prisma';
import { Role } from '@prisma/client';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import type { CreatedUpload } from '../src/videos/videos.service';

const RUN = Date.now();
const UPLOADER = { email: `e2e-uploader-${RUN}@test.local`, password: 'password-e2e-123' };
const INTRUSO = { email: `e2e-intruso-${RUN}@test.local`, password: 'password-e2e-123' };

// Un "MP4" de 1 KiB: al storage le da igual el contenido (la validación de
// formato real es del pipeline en F4); aquí importan tamaño y headers.
const FILE = Buffer.alloc(1024, 1);

describe('Videos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let uploaderToken: string;
  let intrusoToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as App;

    // No hay endpoint para promover roles todavía (panel admin: F6), así
    // que el rol UPLOADER se asigna directo en BD, igual que haría un admin.
    for (const [user, role] of [
      [UPLOADER, Role.UPLOADER],
      [INTRUSO, Role.UPLOADER],
    ] as const) {
      await request(http).post('/auth/register').send(user).expect(201);
      await prisma.user.update({ where: { email: user.email }, data: { role } });
    }
    uploaderToken = await login(UPLOADER);
    intrusoToken = await login(INTRUSO);
  });

  afterAll(async () => {
    await prisma.video.deleteMany({
      where: { owner: { email: { in: [UPLOADER.email, INTRUSO.email] } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [UPLOADER.email, INTRUSO.email] } },
    });
    await app.close();
  });

  async function login(user: { email: string; password: string }): Promise<string> {
    const res = await request(http).post('/auth/login').send(user).expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  function createUpload(
    token: string,
    body: Record<string, unknown> = {},
  ): request.Test {
    return request(http)
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Video e2e',
        fileName: 'demo.mp4',
        sizeBytes: FILE.length,
        ...body,
      });
  }

  /** Sube FILE a la URL prefirmada con los headers exigidos. */
  async function putToStorage(upload: CreatedUpload['upload']) {
    return fetch(upload.url, {
      method: upload.method,
      headers: { ...upload.headers, 'Content-Length': String(FILE.length) },
      // Uint8Array y no Buffer: son lo mismo en runtime, pero el tipo
      // BodyInit del fetch global no conoce Buffer de Node.
      body: new Uint8Array(FILE),
    });
  }

  describe('validaciones de POST /videos', () => {
    it('rechaza extensión que no sea .mp4 → 400', async () => {
      await createUpload(uploaderToken, { fileName: 'troyano.exe' }).expect(400);
    });

    it('rechaza tamaño sobre el límite → 400', async () => {
      await createUpload(uploaderToken, {
        sizeBytes: 501 * 1024 * 1024,
      }).expect(400);
    });
  });

  describe('flujo completo de subida', () => {
    it('POST /videos → registro UPLOADING + URL prefirmada utilizable', async () => {
      const res = await createUpload(uploaderToken).expect(201);
      const { video, upload } = res.body as CreatedUpload;

      expect(video.status).toBe('UPLOADING');
      expect(video.storageKey).toBe(`videos/${video.id}.mp4`);

      // PUT real contra MinIO con los headers firmados.
      const put = await putToStorage(upload);
      expect(put.status).toBe(200);

      // Confirmar: la API verifica el objeto, encola la transcripción (F4) y
      // marca PROCESSING. El worker lo devolverá a READY al terminar.
      const confirmed = await request(http)
        .post(`/videos/${video.id}/confirm`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(200);
      expect((confirmed.body as { status: string }).status).toBe('PROCESSING');

      // Confirmar dos veces → 409 (ya no está UPLOADING).
      await request(http)
        .post(`/videos/${video.id}/confirm`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(409);
    });

    it('confirmar sin haber subido el archivo → 409', async () => {
      const res = await createUpload(uploaderToken).expect(201);
      const { video } = res.body as CreatedUpload;

      await request(http)
        .post(`/videos/${video.id}/confirm`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(409);
    });

    it('la firma rechaza un PUT con Content-Type distinto al firmado', async () => {
      const res = await createUpload(uploaderToken).expect(201);
      const { upload } = res.body as CreatedUpload;

      const put = await fetch(upload.url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(FILE.length),
        },
        body: new Uint8Array(FILE),
      });
      expect(put.status).toBe(403);
    });
  });

  describe('propiedad (PATCH/DELETE propio)', () => {
    let videoId: string;

    beforeAll(async () => {
      const res = await createUpload(uploaderToken).expect(201);
      const { video, upload } = res.body as CreatedUpload;
      videoId = video.id;
      await putToStorage(upload);
    });

    it('PATCH de otro usuario → 403; del dueño → 200', async () => {
      await request(http)
        .patch(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${intrusoToken}`)
        .send({ title: 'hackeado' })
        .expect(403);

      const ok = await request(http)
        .patch(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .send({ title: 'Título editado', description: 'desc' })
        .expect(200);
      expect((ok.body as { title: string }).title).toBe('Título editado');
    });

    it('PATCH a un video inexistente → 404', async () => {
      await request(http)
        .patch('/videos/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${uploaderToken}`)
        .send({ title: 'x' })
        .expect(404);
    });

    it('DELETE de otro usuario → 403; del dueño → 204 y desaparece', async () => {
      await request(http)
        .delete(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${intrusoToken}`)
        .expect(403);

      await request(http)
        .delete(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(204);

      expect(
        await prisma.video.findUnique({ where: { id: videoId } }),
      ).toBeNull();
    });
  });

  describe('revisión del uploader (F5, HU-04)', () => {
    let videoId: string;

    beforeAll(async () => {
      const res = await createUpload(uploaderToken).expect(201);
      videoId = (res.body as CreatedUpload).video.id;
    });

    it('GET /review: del dueño → 200 con campos IA; de otro → 403; inexistente → 404', async () => {
      const own = await request(http)
        .get(`/videos/${videoId}/review`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(200);
      const body = own.body as { id: string; synopsis: string | null; tags: string[] };
      expect(body.id).toBe(videoId);
      // Campos IA presentes aunque vacíos (el pipeline aún no corrió).
      expect(body).toHaveProperty('synopsis');
      expect(Array.isArray(body.tags)).toBe(true);

      await request(http)
        .get(`/videos/${videoId}/review`)
        .set('Authorization', `Bearer ${intrusoToken}`)
        .expect(403);

      await request(http)
        .get('/videos/00000000-0000-4000-8000-000000000000/review')
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(404);
    });

    it('PATCH de synopsis/tags persiste (editar sugerencias antes de publicar)', async () => {
      await request(http)
        .patch(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .send({ synopsis: 'Sinopsis revisada a mano', tags: ['drama', 'corto'] })
        .expect(200);

      const review = await request(http)
        .get(`/videos/${videoId}/review`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(200);
      const body = review.body as { synopsis: string; tags: string[] };
      expect(body.synopsis).toBe('Sinopsis revisada a mano');
      expect(body.tags).toEqual(['drama', 'corto']);
    });

    it('PATCH rechaza un tag que no es string → 400', async () => {
      await request(http)
        .patch(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .send({ tags: [123] })
        .expect(400);
    });
  });
});
