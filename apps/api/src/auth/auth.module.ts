import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { validateEnv } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

/**
 * Módulo de auth (F1). Además de sus endpoints, registra los dos guards
 * como APP_GUARD: TODA la API queda protegida por defecto y los endpoints
 * públicos se marcan con @Public(). El orden importa: JwtAuthGuard puebla
 * req.user y RolesGuard lo lee (se ejecutan en orden de registro).
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      // global: cualquier módulo futuro (videos, admin...) puede inyectar
      // JwtService sin reimportar la configuración del secreto.
      global: true,
      // registerAsync y no register: la factory corre al inicializar la app,
      // DESPUÉS de que dotenv/main carguen el entorno. register() evaluaría
      // process.env al importar el archivo, una carrera que depende del
      // orden de imports.
      useFactory: () => ({
        secret: validateEnv().JWT_SECRET,
        signOptions: { expiresIn: '15m' }, // access corto (plan.md §3)
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
