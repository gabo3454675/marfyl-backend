import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/common/prisma/prisma.service';

export interface RegisterFcmTokenDto {
  token: string;
  deviceInfo?: string;
}

/**
 * Gestión de tokens FCM para notificaciones push.
 * Los Super Admins registran sus tokens para recibir alertas (cierre con faltante, stock crítico).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async registerFcmToken(userId: number, dto: RegisterFcmTokenDto): Promise<{ ok: boolean }> {
    await this.prisma.fcmToken.upsert({
      where: { token: dto.token },
      create: {
        userId,
        token: dto.token,
        deviceInfo: dto.deviceInfo ?? null,
        updatedAt: new Date(),
      },
      update: {
        userId,
        deviceInfo: dto.deviceInfo ?? null,
        updatedAt: new Date(),
      },
    });
    return { ok: true };
  }

  async getFcmTokensForSuperAdmins(): Promise<string[]> {
    const tokens = await this.prisma.fcmToken.findMany({
      where: { user: { isSuperAdmin: true } },
      select: { token: true },
    });
    return tokens.map((t) => t.token);
  }
}
