import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

/**
 * Body de /auth/register y /auth/login (mismos campos, misma validación).
 *
 * El ValidationPipe global rechaza con 400 antes de tocar el servicio;
 * el mínimo de 8 caracteres solo aplica al registrar — en login una
 * contraseña corta simplemente no va a coincidir con ningún hash.
 */
export class RegisterDto {
  @ApiProperty({ example: 'ana@example.com' })
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email!: string;

  @ApiProperty({ example: 'minimo-8-chars', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  password!: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ana@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'minimo-8-chars' })
  @IsString()
  password!: string;
}
