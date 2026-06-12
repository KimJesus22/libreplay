import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthResult, AuthService, PublicUser } from './auth.service';
import { Public } from './decorators/public.decorator';
import { LoginDto, RegisterDto } from './dto/register.dto';

export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // mismo TTL que el JWT (7d)

/** Respuesta HTTP de los tres endpoints: el refresh va aparte, en cookie. */
interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

/**
 * Los tres endpoints de F1 (tasks.md). El refresh token viaja SOLO en una
 * cookie httpOnly (plan.md §8): el JS del navegador no puede leerla, así
 * que un XSS puede robar a lo sumo el access token de 15 min, no la sesión
 * de 7 días. El access sí va en el body — el frontend lo guarda en memoria
 * y lo manda como Bearer.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Crear cuenta (rol viewer) e iniciar sesión' })
  @ApiResponse({ status: 409, description: 'El email ya está registrado' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.reply(res, await this.auth.register(dto.email, dto.password));
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK) // login no crea recursos: 200, no el 201 default de POST
  @ApiOperation({ summary: 'Iniciar sesión con email y contraseña' })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.reply(res, await this.auth.login(dto.email, dto.password));
  }

  // @Public porque su credencial es la cookie, no el header Bearer: el caso
  // de uso típico es justamente "mi access token ya venció".
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar sesión con la cookie de refresh (rotativo)' })
  @ApiResponse({ status: 401, description: 'Cookie ausente, inválida o ya rotada' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const token = (req.cookies as Record<string, string> | undefined)?.[
      REFRESH_COOKIE
    ];
    if (!token) throw new UnauthorizedException('Falta la cookie de refresh');
    return this.reply(res, await this.auth.refresh(token));
  }

  /** Setea la cookie de refresh y arma el body sin el token. */
  private reply(res: Response, result: AuthResult): AuthResponse {
    res.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      // En dev el navegador no manda cookies `secure` por http://localhost.
      secure: process.env.NODE_ENV === 'production',
      // Solo se adjunta bajo /auth: el resto de la API nunca ve el refresh,
      // un endpoint con un log de headers descuidado no puede filtrarlo.
      path: '/auth',
      maxAge: REFRESH_TTL_MS,
    });
    return { user: result.user, accessToken: result.accessToken };
  }
}
