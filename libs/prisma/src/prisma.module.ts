import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global: PrismaService queda disponible en cualquier módulo sin tener que
 * importar PrismaModule en cada uno. Es una excepción deliberada a la regla
 * de "imports explícitos" de Nest: la BD es transversal por naturaleza
 * (auth, videos, search... TODOS la usan) y repetir el import en cada módulo
 * sería ruido sin información. Misma excepción que hace @nestjs/config.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
