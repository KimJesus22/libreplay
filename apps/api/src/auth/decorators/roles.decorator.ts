import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Restringe un endpoint a los roles listados (evaluado por RolesGuard).
 *
 * La lista es explícita, sin jerarquía implícita (ADMIN no "hereda" UPLOADER):
 * un endpoint que admite ambos escribe @Roles(Role.UPLOADER, Role.ADMIN).
 * Más verboso, pero quién puede entrar a cada ruta se lee en la ruta misma.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
