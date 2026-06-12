import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AccessPayload, AuthenticatedRequest } from '../token-payload';

/**
 * Guard global de autenticación (criterio §6.4: sin token válido → 401).
 *
 * Registrado como APP_GUARD para que todo endpoint nazca protegido; lo
 * público se abre con @Public(). Implementado a mano en vez de con
 * @nestjs/passport: passport-jwt envuelve estas mismas ~10 líneas en tres
 * capas de estrategia/abstracción y otra dependencia que explicar.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // getAllAndOverride: el decorador en el handler gana al de la clase.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Falta el token Bearer');

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token);
      // Un refresh token firmado con el mismo secreto NO sirve como access
      // (ver token-payload.ts).
      if (payload.type !== 'access') throw new Error('tipo incorrecto');
      req.user = payload;
      return true;
    } catch {
      // Vencido, mal firmado o de tipo incorrecto: mismo 401 opaco para
      // todos — el detalle solo le serviría a un atacante.
      throw new UnauthorizedException('Token inválido o vencido');
    }
  }
}
