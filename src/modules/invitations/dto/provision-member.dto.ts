import { IsString, IsEmail, IsEnum, IsNotEmpty, IsOptional, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class ProvisionMemberDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsEnum(Role)
  @IsNotEmpty()
  role: Role;

  /** Nombre completo del usuario (recomendado para usuarios nuevos). */
  @IsOptional()
  @IsString()
  fullName?: string;

  /** Contraseña temporal (opcional). Si no se envía, se genera una automática. */
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres' })
  tempPassword?: string;
}
