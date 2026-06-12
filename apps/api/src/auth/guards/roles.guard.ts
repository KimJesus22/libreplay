import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../token-payload';

/**
 * Guard global de autorización (criterio §6.4: viewer en endpoint de
 * uploader → 403).
 *
 * Corre DESPUÉS de JwtAuthGuard (los APP_GUARD se evalúan en orden de
 * registro), así que si hay @Roles, req.user ya existe: un endpoint con
 * roles y sin usuario es imposible salvo bug, y en ese caso 403 es la
 * respuesta segura.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    // Sin @Roles no hay restricción de rol: basta con estar autenticado.
    if (!required || required.length === 0) return true;

    const { user } = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException('Tu rol no permite esta operación');
    }
    return true;
  }
}
