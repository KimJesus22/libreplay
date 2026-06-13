// Tests e2e de F3 (HU-05/HU-06): catálogo público (filtro + orden), publicación
// y streaming. El criterio §6.1 se prueba de verdad: se pide la URL de stream y
// se hace un PUT/GET REAL contra MinIO con header `Range` para verificar el 206.
//
// Requisitos: `docker compose up -d db minio` y `.env` con DATABASE_URL,
// JWT_SECRET y S3_*.
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
const UPLOADER = { email: `e2e-cat-up-${RUN}@test.local`, password: 'password-e2e-123' };
const VIEWER = { email: `e2e-cat-view-${RUN}@test.local`, password: 'password-e2e-123' };

const FILE = Buffer.alloc(1024, 7);

describe('Catálogo y streaming (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let uploaderToken: string;
  let viewerToken: string;
  // Video que llega hasta PUBLISHED y se usa en catálogo/stream.
  let publishedId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as App;

    await request(http).post('/auth/register').send(UPLOADER).expect(201);
    await prisma.user.update({
      where: { email: UPLOADER.email },
      data: { role: Role.UPLOADER },
    });
    // VIEWER se queda con el rol por defecto: reproducir no exige uploader.
    await request(http).post('/auth/register').send(VIEWER).expect(201);

    uploaderToken = await login(UPLOADER);
    viewerToken = await login(VIEWER);
  });

  afterAll(async () => {
    await prisma.video.deleteMany({
      where: { owner: { email: UPLOADER.email } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: [UPLOADER.email, VIEWER.email] } },
    });
    await app.close();
  });

  async function login(user: { email: string; password: string }): Promise<string> {
    const res = await request(http).post('/auth/login').send(user).expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  /** Crea un video, sube los bytes a MinIO y lo confirma (queda READY). */
  async function uploadReady(title: string): Promise<string> {
    const res = await request(http)
      .post('/videos')
      .set('Authorization', `Bearer ${uploaderToken}`)
      .send({ title, fileName: 'demo.mp4', sizeBytes: FILE.length })
      .expect(201);
    const { video, upload } = res.body as CreatedUpload;

    const put = await fetch(upload.url, {
      method: upload.method,
      headers: { ...upload.headers, 'Content-Length': String(FILE.length) },
      body: new Uint8Array(FILE),
    });
    expect(put.status).toBe(200);

    await request(http)
      .post(`/videos/${video.id}/confirm`)
      .set('Authorization', `Bearer ${uploaderToken}`)
      .expect(200);
    return video.id;
  }

  describe('publicación', () => {
    it('publicar un video READY → PUBLISHED con publishedAt', async () => {
      publishedId = await uploadReady('Catálogo publicado');

      // Categorizar antes de publicar (lo hará la IA en F5; aquí a mano).
      await request(http)
        .patch(`/videos/${publishedId}`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .send({ categories: ['CINE', 'DOCUMENTAL'] })
        .expect(200);

      const res = await request(http)
        .post(`/videos/${publishedId}/publish`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(200);
      const body = res.body as { status: string; publishedAt: string | null };
      expect(body.status).toBe('PUBLISHED');
      expect(body.publishedAt).not.toBeNull();
    });

    it('publicar un video que no está READY (UPLOADING) → 409', async () => {
      const res = await request(http)
        .post('/videos')
        .set('Authorization', `Bearer ${uploaderToken}`)
        .send({ title: 'Sin subir', fileName: 'x.mp4', sizeBytes: FILE.length })
        .expect(201);
      const { video } = res.body as CreatedUpload;

      await request(http)
        .post(`/videos/${video.id}/publish`)
        .set('Authorization', `Bearer ${uploaderToken}`)
        .expect(409);
    });
  });

  describe('catálogo público (GET /videos)', () => {
    it('lista sin token e incluye el video publicado', async () => {
      const res = await request(http).get('/videos').expect(200);
      const body = res.body as { items: { id: string }[]; total: number };
      expect(body.items.some((v) => v.id === publishedId)).toBe(true);
      // La proyección pública no filtra la clave interna del storage.
      expect(body.items[0]).not.toHaveProperty('storageKey');
    });

    it('filtra por categoría', async () => {
      const hit = await request(http).get('/videos?category=CINE').expect(200);
      expect((hit.body as { items: { id: string }[] }).items.some((v) => v.id === publishedId)).toBe(true);

      const miss = await request(http).get('/videos?category=GAMING').expect(200);
      expect((miss.body as { items: { id: string }[] }).items.some((v) => v.id === publishedId)).toBe(false);
    });

    it('rechaza una categoría inválida → 400', async () => {
      await request(http).get('/videos?category=NOEXISTE').expect(400);
    });

    it('un video sólo READY (sin publicar) no aparece en el catálogo', async () => {
      const readyId = await uploadReady('Sólo READY');
      const res = await request(http).get('/videos?pageSize=100').expect(200);
      expect((res.body as { items: { id: string }[] }).items.some((v) => v.id === readyId)).toBe(false);
    });

    it('GET /videos/:id de un publicado → 200; de uno no publicado → 404', async () => {
      await request(http).get(`/videos/${publishedId}`).expect(200);

      const readyId = await uploadReady('No publicado detalle');
      await request(http).get(`/videos/${readyId}`).expect(404);
    });
  });

  describe('streaming (GET /videos/:id/stream, §6.1)', () => {
    it('sin token → 401', async () => {
      await request(http).get(`/videos/${publishedId}/stream`).expect(401);
    });

    it('con sesión devuelve URL prefirmada y un Range real responde 206', async () => {
      const before = await prisma.video.findUnique({
        where: { id: publishedId },
        select: { views: true },
      });

      const res = await request(http)
        .get(`/videos/${publishedId}/stream`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      const { url } = res.body as { url: string; expiresInS: number };
      expect(url).toContain('videos/');

      // El navegador hace exactamente esto: GET con Range sobre la URL firmada.
      const ranged = await fetch(url, { headers: { Range: 'bytes=0-99' } });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get('content-range')).toMatch(/^bytes 0-99\/1024$/);
      const bytes = new Uint8Array(await ranged.arrayBuffer());
      expect(bytes.length).toBe(100);

      // Pedir la URL contó como una vista.
      const after = await prisma.video.findUnique({
        where: { id: publishedId },
        select: { views: true },
      });
      expect(after!.views).toBe(before!.views + 1);
    });

    it('stream de un video no publicado → 404', async () => {
      const readyId = await uploadReady('No publicado stream');
      await request(http)
        .get(`/videos/${readyId}/stream`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(404);
    });
  });
});
