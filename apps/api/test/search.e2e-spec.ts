// Tests e2e de F5 (HU-07, §6.3): búsqueda por texto (tsvector) y semántica
// (pgvector + coseno). La parte semántica es HERMÉTICA: se sobreescribe
// EmbeddingsService para devolver un vector fijo, así el test no necesita Ollama
// y verifica de verdad el ORDEN por distancia y el UMBRAL. Los embeddings de los
// videos se siembran con SQL crudo (la columna es Unsupported en Prisma).
//
// Requisitos: `docker compose up -d db` con la migración add_metadata_search
// aplicada, y `.env` con DATABASE_URL/JWT_SECRET/REDIS_URL/S3_*/OLLAMA_URL.
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@app/prisma';
import { EmbeddingsService, EMBEDDING_DIMS } from '@app/ai';
import { Role } from '@prisma/client';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

const RUN = Date.now();
const UPLOADER = { email: `e2e-search-${RUN}@test.local`, password: 'password-e2e-123' };

// Vectores ortogonales de juguete: el "robot" apunta al eje 0, la "cocina" al 1.
// Distancia coseno entre ellos = 1.0 (> umbral 0.6), así el modo semántico
// devuelve uno y filtra el otro.
function unitVector(axis: number): number[] {
  const v = new Array<number>(EMBEDDING_DIMS).fill(0);
  v[axis] = 1;
  return v;
}
const ROBOT_VEC = unitVector(0);
const COCINA_VEC = unitVector(1);

// Doble de EmbeddingsService: la búsqueda semántica embebe la QUERY con esto.
// Devolvemos siempre el vector "robot" → la query se parece al video del robot.
const fakeEmbeddings = {
  embed: jest.fn(() => Promise.resolve(ROBOT_VEC)),
};

describe('Búsqueda (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let robotId: string;
  let cocinaId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmbeddingsService)
      .useValue(fakeEmbeddings)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as App;

    await request(http).post('/auth/register').send(UPLOADER).expect(201);
    const owner = await prisma.user.update({
      where: { email: UPLOADER.email },
      data: { role: Role.UPLOADER },
    });

    // Dos videos PUBLISHED con contenido bien distinto. La columna searchVector
    // se genera sola desde title+description+synopsis (modo texto).
    const robot = await prisma.video.create({
      data: {
        ownerId: owner.id,
        title: 'El despertar',
        synopsis: 'Un robot que aprende a sentir emociones y descubre la empatía.',
        storageKey: `videos/e2e-search-robot-${RUN}.mp4`,
        sizeBytes: 1024,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        categories: ['CINE'],
      },
    });
    const cocina = await prisma.video.create({
      data: {
        ownerId: owner.id,
        title: 'Recetas de la abuela',
        synopsis: 'Cocina tradicional española con ingredientes frescos del mercado.',
        storageKey: `videos/e2e-search-cocina-${RUN}.mp4`,
        sizeBytes: 1024,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        categories: ['EDUCACION'],
      },
    });
    robotId = robot.id;
    cocinaId = cocina.id;

    // Sembrar los embeddings con SQL crudo (Prisma no escribe `vector`).
    await prisma.$executeRawUnsafe(
      `UPDATE "Video" SET embedding = $1::vector WHERE id = $2`,
      EmbeddingsService.toSqlVector(ROBOT_VEC),
      robotId,
    );
    await prisma.$executeRawUnsafe(
      `UPDATE "Video" SET embedding = $1::vector WHERE id = $2`,
      EmbeddingsService.toSqlVector(COCINA_VEC),
      cocinaId,
    );
  });

  afterAll(async () => {
    await prisma.video.deleteMany({ where: { owner: { email: UPLOADER.email } } });
    await prisma.user.deleteMany({ where: { email: UPLOADER.email } });
    await app.close();
  });

  describe('modo texto (tsvector)', () => {
    it('"robot" encuentra el video del robot, no el de cocina', async () => {
      const res = await request(http).get('/search?q=robot&mode=text').expect(200);
      const body = res.body as { items: { id: string }[]; mode: string };
      expect(body.mode).toBe('text');
      const ids = body.items.map((v) => v.id);
      expect(ids).toContain(robotId);
      expect(ids).not.toContain(cocinaId);
    });

    it('"cocina" encuentra el video de cocina', async () => {
      const res = await request(http).get('/search?q=cocina&mode=text').expect(200);
      const ids = (res.body as { items: { id: string }[] }).items.map((v) => v.id);
      expect(ids).toContain(cocinaId);
      expect(ids).not.toContain(robotId);
    });

    it('la proyección no expone storageKey', async () => {
      const res = await request(http).get('/search?q=robot').expect(200);
      const items = (res.body as { items: object[] }).items;
      expect(items[0]).not.toHaveProperty('storageKey');
    });

    it('q demasiado corta → 400', async () => {
      await request(http).get('/search?q=a').expect(400);
    });
  });

  describe('modo semántico (pgvector + coseno)', () => {
    it('encuentra el video por significado SIN coincidencia de palabras', async () => {
      // La query no comparte ninguna palabra con "El despertar"; el doble de
      // embeddings la mapea al vector del robot → lo encuentra por cercanía.
      const res = await request(http)
        .get('/search?q=inteligencia%20artificial%20con%20sentimientos&mode=semantic')
        .expect(200);
      const body = res.body as { items: { id: string }[]; mode: string };
      expect(body.mode).toBe('semantic');
      expect(fakeEmbeddings.embed).toHaveBeenCalled();
      const ids = body.items.map((v) => v.id);
      // El robot (distancia 0) entra; la cocina (distancia 1.0) cae por el umbral.
      expect(ids).toContain(robotId);
      expect(ids).not.toContain(cocinaId);
    });
  });
});
