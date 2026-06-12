// Tests e2e de F1 (tasks.md): criterio §6.4 — sin token → 401, viewer en
// endpoint de uploader → 403 — más el ciclo register/login/refresh rotativo.
//
// Requisitos para correrlos: Postgres arriba (`docker compose up -d db`) y
// `.env` con DATABASE_URL y JWT_SECRET (dotenv lo carga abajo). Van contra
// la BD real de dev: mockear Prisma aquí dejaría sin probar justo lo que
// importa (unique de email, persistencia del hash de refresh).
import 'dotenv/config';
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@app/prisma';
import { Role } from '@prisma/client';
import * as request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Roles } from '../src/auth/decorators/roles.decorator';

/** Forma del body que devuelven los tres endpoints de /auth. */
interface AuthBody {
  user: { id: string; email: string; role: string; password?: string };
  accessToken: string;
}

// Endpoints de prueba para ejercitar los guards: el endpoint real de
// uploader (POST /videos) llega en F2; cuando exista, el test de 403 puede
// apuntarle. Mientras tanto esto prueba exactamente el mismo camino:
// APP_GUARDs globales + metadata @Roles.
@Controller('e2e-guards')
class GuardsTestController {
  @Get('protegido')
  protegido() {
    return { ok: true };
  }

  @Roles(Role.UPLOADER)
  @Get('solo-uploader')
  soloUploader() {
    return { ok: true };
  }
}

// Email único por corrida: los tests no chocan con datos de corridas
// anteriores ni requieren limpiar la BD entera.
const EMAIL = `e2e-${Date.now()}@test.local`;
const PASSWORD = 'password-e2e-123';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // getHttpServer() devuelve `any`; un cast único aquí mantiene tipado el
  // resto del archivo (la regla no-unsafe-argument del lint).
  let http: App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [GuardsTestController],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app); // los MISMOS pipes/cookie-parser que producción
    await app.init();
    prisma = app.get(PrismaService);
    http = app.getHttpServer() as App;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await app.close();
  });

  /** Extrae la cookie refresh_token del Set-Cookie de una respuesta. */
  function refreshCookie(res: request.Response): string {
    const cookies = res.get('Set-Cookie') ?? [];
    const cookie = cookies.find((c) => c.startsWith('refresh_token='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    return cookie!;
  }

  describe('registro y login', () => {
    it('POST /auth/register crea el usuario como VIEWER y abre sesión', async () => {
      const res = await request(http)
        .post('/auth/register')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(201);

      const body = res.body as AuthBody;
      expect(body.user).toMatchObject({ email: EMAIL, role: 'VIEWER' });
      expect(body.accessToken).toEqual(expect.any(String));
      // El password (ni su hash) jamás sale por la API.
      expect(body.user.password).toBeUndefined();
      refreshCookie(res);
    });

    it('POST /auth/register con email repetido → 409', async () => {
      await request(http)
        .post('/auth/register')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(409);
    });

    it('POST /auth/register con body inválido → 400 (ValidationPipe)', async () => {
      await request(http)
        .post('/auth/register')
        .send({ email: 'no-es-un-email', password: 'corta' })
        .expect(400);
    });

    it('POST /auth/login con password incorrecto → 401', async () => {
      await request(http)
        .post('/auth/login')
        .send({ email: EMAIL, password: 'password-equivocado' })
        .expect(401);
    });

    it('POST /auth/login con credenciales válidas → 200 + tokens', async () => {
      const res = await request(http)
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD })
        .expect(200);

      expect((res.body as AuthBody).accessToken).toEqual(expect.any(String));
      refreshCookie(res);
    });
  });

  describe('guards (§6.4)', () => {
    it('endpoint protegido sin token → 401', async () => {
      await request(http).get('/e2e-guards/protegido').expect(401);
    });

    it('endpoint protegido con token de mentira → 401', async () => {
      await request(http)
        .get('/e2e-guards/protegido')
        .set('Authorization', 'Bearer token-falso')
        .expect(401);
    });

    it('endpoint protegido con token válido → 200', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      await request(http)
        .get('/e2e-guards/protegido')
        .set('Authorization', `Bearer ${(login.body as AuthBody).accessToken}`)
        .expect(200);
    });

    it('viewer en endpoint de uploader → 403', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD });

      await request(http)
        .get('/e2e-guards/solo-uploader')
        .set('Authorization', `Bearer ${(login.body as AuthBody).accessToken}`)
        .expect(403);
    });
  });

  describe('refresh rotativo', () => {
    it('POST /auth/refresh sin cookie → 401', async () => {
      await request(http).post('/auth/refresh').expect(401);
    });

    it('rota el token: el nuevo sirve, el usado queda inservible', async () => {
      const login = await request(http)
        .post('/auth/login')
        .send({ email: EMAIL, password: PASSWORD });
      const oldCookie = refreshCookie(login);

      // Primer refresh: funciona y entrega cookie nueva.
      const refreshed = await request(http)
        .post('/auth/refresh')
        .set('Cookie', oldCookie)
        .expect(200);
      expect((refreshed.body as AuthBody).accessToken).toEqual(
        expect.any(String),
      );
      const newCookie = refreshCookie(refreshed);
      expect(newCookie).not.toEqual(oldCookie);

      // Reusar la cookie YA rotada → 401 (la rotación invalida el anterior).
      await request(http)
        .post('/auth/refresh')
        .set('Cookie', oldCookie)
        .expect(401);

      // La nueva sigue siendo válida.
      await request(http)
        .post('/auth/refresh')
        .set('Cookie', newCookie)
        .expect(200);
    });
  });
});
