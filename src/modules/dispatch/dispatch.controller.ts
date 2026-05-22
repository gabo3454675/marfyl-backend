import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { DispatchService } from './dispatch.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import type { Request } from 'express';

@Controller('dispatch')
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}

  // Publico: acceso cliente sin login (cedula + companyId)
  @Post('search-by-national-id')
  async searchByNationalId(
    @Body() body: { companyId: string; nationalId: string },
  ) {
    return this.dispatchService.proxyPost('/api/v1/dispatch/search-by-national-id', body, {
      'x-role': 'PUNTO_RETIRO',
    });
  }

  @Post('scan-qr')
  @UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN', 'SUPER_ADMIN')
  async scanQr(
    @Body() body: { companyId: string; nationalId: string; token: string },
    @Req() req: Request,
  ) {
    return this.dispatchService.proxyPost('/api/v1/dispatch/scan-qr', body, {
      authorization: String(req.headers.authorization ?? ''),
      'x-tenant-id': String(req.headers['x-tenant-id'] ?? ''),
    });
  }

  @Post('manual-search')
  @UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN', 'SUPER_ADMIN')
  async manualSearch(
    @Body() body: { companyId: string; nationalId: string; pin?: string },
    @Req() req: Request,
  ) {
    return this.dispatchService.proxyPost('/api/v1/dispatch/manual-search', body, {
      authorization: String(req.headers.authorization ?? ''),
      'x-tenant-id': String(req.headers['x-tenant-id'] ?? ''),
    });
  }

  @Post('confirm-dispatch')
  @UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
  @Roles('DISPATCHER', 'ADMIN', 'SUPER_ADMIN')
  async confirmDispatch(
    @Body()
    body: {
      companyId: string;
      nationalId: string;
      amount: number;
      productId?: string;
      quantity?: number;
      idempotencyKey?: string;
    },
    @Headers('x-idempotency-key') idempotencyKeyHeader: string | undefined,
    @Req() req: Request,
  ) {
    return this.dispatchService.proxyPost(
      '/api/v1/dispatch/confirm-dispatch',
      {
        ...body,
        idempotencyKey: body.idempotencyKey ?? idempotencyKeyHeader,
      },
      {
        authorization: String(req.headers.authorization ?? ''),
        'x-tenant-id': String(req.headers['x-tenant-id'] ?? ''),
        'x-idempotency-key': idempotencyKeyHeader,
      },
    );
  }
}
