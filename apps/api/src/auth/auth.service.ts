import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '@app/prisma';
import * as argon2 from 'argon2';
import { createHash, randomUUID } from 'node:crypto';
import { AccessPayload, RefreshPayload } from './token-payload';

/** Lo que se expone de un usuario por la API — nunca password ni hashes. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  user: PublicUser;
  accessToken: string;
  /** Va en cookie httpOnly (lo pone el controller), jamás en el body JSON. */
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthResult> {
    let user: User;
    try {
      user = await this.prisma.user.create({
        // argon2id con parámetros por defecto de la lib (los recomendados
        // por OWASP); el rol siempre es VIEWER — promover a UPLOADER/ADMIN
        // es decisión de un admin, no del formulario de registro.
        data: { email, password: await argon2.hash(password) },
      });
    } catch (e) {
      // P2002 = violación de unique. Sí, esto revela que el email existe
      // (enumeración), pero /register lo revela por definición; ocultarlo
      // con un mensaje genérico solo empeora la UX sin ganar seguridad.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Ese email ya está registrado');
      }
      throw e;
    }
    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Verificar aun si el usuario no existe (contra un hash dummy) igualaría
    // los tiempos de respuesta, pero el 409 de /register ya delata qué
    // emails existen — sería teatro de seguridad. Mismo mensaje en ambos
    // casos, eso sí: el atacante no distingue "no existe" de "password mal".
    if (!user || !(await argon2.verify(user.password, password))) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return this.issueTokens(user);
  }

  /**
   * Rotación de refresh (plan.md §8): valida el token contra el hash en BD,
   * y emitir los nuevos sobreescribe ese hash — el token usado queda
   * inservible. Un refresh robado funciona una sola vez, y si el legítimo
   * llega después, falla y delata el robo.
   */
  async refresh(refreshToken: string): Promise<AuthResult> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken);
      if (payload.type !== 'refresh') throw new Error('tipo incorrecto');
    } catch {
      throw new UnauthorizedException('Refresh token inválido o vencido');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (
      !user ||
      user.refreshTokenHash === null ||
      user.refreshTokenHash !== sha256(refreshToken)
    ) {
      throw new UnauthorizedException('Refresh token inválido o vencido');
    }
    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<AuthResult> {
    const accessPayload: AccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const refreshPayload: RefreshPayload = {
      sub: user.id,
      type: 'refresh',
      jti: randomUUID(), // unicidad por emisión — ver token-payload.ts
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload), // 15 min — default del JwtModule
      this.jwt.signAsync(refreshPayload, { expiresIn: '7d' }),
    ]);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: sha256(refreshToken) },
    });

    return {
      user: { id: user.id, email: user.email, role: user.role },
      accessToken,
      refreshToken,
    };
  }
}

/**
 * SHA-256 y no argon2 para el refresh token: argon2 es lento a propósito
 * para compensar la baja entropía de contraseñas humanas; un JWT firmado
 * con secreto de 256 bits no es adivinable por fuerza bruta, así que el
 * hash rápido da la misma protección ante un dump de BD sin pagar ~100 ms
 * en cada request a /auth/refresh.
 */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
