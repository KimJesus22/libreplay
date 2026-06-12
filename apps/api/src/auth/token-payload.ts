import { Role } from '@prisma/client';
import { Request } from 'express';

/**
 * Payloads de los dos JWT que emite la API.
 *
 * El claim `type` evita el ataque de confusión de tokens: ambos se firman con
 * el mismo secreto, así que sin él un refresh (7 días de vida) serviría como
 * access token y la expiración corta de 15 min sería decorativa.
 */
export interface AccessPayload {
  sub: string; // user.id
  email: string;
  role: Role;
  type: 'access';
}

export interface RefreshPayload {
  sub: string;
  type: 'refresh';
  // UUID aleatorio por emisión: sin él, dos refresh del mismo usuario en el
  // mismo segundo serían bit a bit idénticos (el iat de JWT va en segundos)
  // y la rotación no rotaría nada.
  jti: string;
}

/** Request de Express con el payload que JwtAuthGuard adjunta tras validar. */
export interface AuthenticatedRequest extends Request {
  user?: AccessPayload;
}
