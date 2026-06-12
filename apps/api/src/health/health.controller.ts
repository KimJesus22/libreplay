import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '@app/prisma';
import { Public } from '../auth/decorators/public.decorator';

/**
 * GET /health — cumple dos funciones:
 *
 * 1. Demo de la Fase 0: probar que API + Docker + Postgres + Swagger funcionan.
 * 2. En producción, el monitor de uptime (UptimeRobot) y el healthcheck de
 *    Docker le pegarán a esta ruta para saber si la API vive.
 *
 * Usa @nestjs/terminus en vez de devolver { status: 'ok' } a mano: terminus
 * ejecuta "indicadores" reales (aquí, un SELECT 1 contra Postgres vía Prisma)
 * y responde 503 con el detalle si alguno falla. Un "ok" con la BD caída
 * sería mentira — el health check debe probar dependencias, no existencia.
 */
@ApiTags('health')
// Público: el monitor de uptime y el healthcheck de Docker no tienen JWT.
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado de la API y sus dependencias' })
  @HealthCheck() // documenta en Swagger las respuestas 200/503 de terminus
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      // DEUDA: falta el indicador de Redis. Se agrega en F4, cuando exista
      // un cliente Redis en la API (BullMQ); antes no hay conexión que probar.
    ]);
  }
}
