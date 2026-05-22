import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/common/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'esta_es_una_clave_super_secreta_para_disis_2026',
    });
  }

  async validate(payload: { sub: number; email?: string; isSuperAdmin?: boolean; organizationId?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, isSuperAdmin: true },
    });
    if (!user || user.isActive === false) {
      throw new UnauthorizedException('Cuenta desactivada o no válida');
    }
    return {
      id: payload.sub,
      email: payload.email,
      isSuperAdmin: user.isSuperAdmin ?? false,
      // TenantId solo desde JWT; el backend no confía en headers ni body.
      tenantId: payload.organizationId,
      organizationId: payload.organizationId,
    };
  }
}
