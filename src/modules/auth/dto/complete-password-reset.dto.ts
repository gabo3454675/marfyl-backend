import { IsEmail, IsString, MinLength } from 'class-validator';

export class CompletePasswordResetDto {
  @IsEmail()
  email: string;

  @IsString()
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'La nueva contraseña debe tener al menos 8 caracteres' })
  newPassword: string;
}
