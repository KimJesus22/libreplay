import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Único punto de acceso a la base de datos en todo el monorepo.
 *
 * Extiende PrismaClient (hereda todos los métodos de query tipados) y se
 * engancha al ciclo de vida de Nest:
 * - onModuleInit → $connect(): conectar al ARRANCAR, no en el primer query.
 *   Si DATABASE_URL está mal, la app muere al instante con un error claro,
 *   en vez de explotar a mitad de un request en producción.
 * - onModuleDestroy → $disconnect(): cierre limpio al recibir SIGTERM
 *   (docker stop), sin dejar conexiones zombis en Postgres.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
