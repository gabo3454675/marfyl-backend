import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { NotificationsService } from './notifications.service';

export class RegisterFcmTokenDto {
  token!: string;
  deviceInfo?: string;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('fcm-token')
  async registerFcmToken(
    @ActiveUser() user: { id: number },
    @Body() dto: RegisterFcmTokenDto,
  ) {
    return this.notifications.registerFcmToken(user.id, {
      token: dto.token,
      deviceInfo: dto.deviceInfo,
    });
  }
}
