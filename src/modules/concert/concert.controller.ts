import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ConcertOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { ConcertService } from './concert.service';
import { ScanTicketDto } from './dto/checkout.dto';
import { AdminSellDto } from './dto/admin-sell.dto';

@Controller('concert/admin')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class ConcertController {
  constructor(private readonly concertService: ConcertService) {}

  @Get('overview')
  overview(@ActiveOrganization() organizationId: number) {
    return this.concertService.getAdminOverview(organizationId);
  }

  @Post('setup')
  setup(@ActiveOrganization() organizationId: number) {
    return this.concertService.ensureDefaultEvent(organizationId);
  }

  @Post('sync-catalog')
  syncCatalog(@ActiveOrganization() organizationId: number) {
    return this.concertService.syncSeatCatalog(organizationId);
  }

  @Get('orders')
  listOrders(
    @ActiveOrganization() organizationId: number,
    @Query('status') status?: ConcertOrderStatus,
  ) {
    return this.concertService.listOrders(organizationId, status);
  }

  @Post('orders/:id/confirm')
  confirm(
    @ActiveOrganization() organizationId: number,
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: { sub: number },
  ) {
    return this.concertService.confirmOrder(organizationId, id, user.sub);
  }

  @Post('sell')
  sell(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { sub: number },
    @Body() dto: AdminSellDto,
  ) {
    return this.concertService.adminSell(organizationId, user.sub, dto);
  }

  @Post('scan')
  scan(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { sub: number },
    @Body() dto: ScanTicketDto,
  ) {
    return this.concertService.scanTicket(organizationId, user.sub, dto.qrPayload);
  }
}
