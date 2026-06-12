import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como accesible sin token.
 *
 * JwtAuthGuard es global (seguro por defecto: olvidar un decorador deja un
 * endpoint cerrado, no abierto), así que lo público se declara explícito:
 * health, register, login y refresh — refresh se autentica con su propia
 * cookie, no con el access token, que para eso puede estar vencido.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
