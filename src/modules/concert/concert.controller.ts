import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
  Res,
} from "@nestjs/common";
import { Response } from "express";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { RolesGuard } from "@/common/guards/roles.guard";
import { Roles } from "@/common/decorators/roles.decorator";
import { Role } from "@prisma/client";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";
import { ConcertService } from "./concert.service";
import { UploadService } from "@/common/services/upload.service";
import { ScanTicketDto } from "./dto/checkout.dto";
import { AdminSellDto } from "./dto/admin-sell.dto";
import { SearchOrdersDto, ListOrdersQueryDto } from "./dto/search-orders.dto";
import * as path from "path";
import * as fs from "fs";
import { NotFoundException } from "@nestjs/common";

@Controller("concert/admin")
@UseGuards(JwtAuthGuard, OrganizationGuard, RolesGuard)
export class ConcertController {
  constructor(private readonly concertService: ConcertService,
    private readonly uploadService: UploadService,
  ) {}

  @Get("overview")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  overview(@ActiveOrganization() organizationId: number) {
    return this.concertService.getAdminOverview(organizationId);
  }

  @Post("setup")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  setup(@ActiveOrganization() organizationId: number) {
    return this.concertService.ensureDefaultEvent(organizationId);
  }

  @Post("sync-catalog")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  syncCatalog(@ActiveOrganization() organizationId: number) {
    return this.concertService.syncSeatCatalog(organizationId);
  }

  @Post("release-mesa/:mesa")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  releaseMesa(
    @ActiveOrganization() organizationId: number,
    @Param("mesa", ParseIntPipe) mesa: number,
  ) {
    return this.concertService.releaseMesaSeats(organizationId, mesa);
  }

  @Get("orders")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  listOrders(
    @ActiveOrganization() organizationId: number,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.concertService.listOrders(
      organizationId,
      query.status,
      query.paymentMethod,
      query.paymentReference,
    );
  }

  @Get("orders/search")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  searchOrders(
    @ActiveOrganization() organizationId: number,
    @Query() query: SearchOrdersDto,
  ) {
    return this.concertService.searchOrdersByCustomer(organizationId, query.q);
  }

  @Post("orders/:id/confirm")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  confirm(
    @ActiveOrganization() organizationId: number,
    @Param("id", ParseIntPipe) id: number,
    @ActiveUser() user: { sub: number },
  ) {
    return this.concertService.confirmOrder(organizationId, id, user.sub);
  }

  @Post("orders/:id/resend-email")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  async resendOrderEmail(
    @Param("id", ParseIntPipe) orderId: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.concertService.resendOrderEmail(organizationId, orderId);
  }

  @Post("orders/:id/cancel")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  async cancelOrder(
    @Param("id", ParseIntPipe) orderId: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.concertService.cancelOrder(organizationId, orderId);
  }

  @Post("sell")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.SELLER)
  sell(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { sub: number },
    @Body() dto: AdminSellDto,
  ) {
    return this.concertService.adminSell(organizationId, user.sub, dto);
  }

  @Post("scan")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER, Role.SELLER)
  scan(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { sub: number },
    @Body() dto: ScanTicketDto,
  ) {
    return this.concertService.scanTicket(
      organizationId,
      user.sub,
      dto.qrPayload,
    );
  }

    @Get("orders/:id/proof")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  async getOrderProof(
    @Param("id", ParseIntPipe) orderId: number,
    @ActiveOrganization() organizationId: number,
    @Res() res: Response,
  ) {
    const order = await this.concertService.getOrderForProof(
      organizationId,
      orderId,
    );
    if (!order || !order.paymentProofUrl) {
      throw new NotFoundException("Comprobante de pago no encontrado");
    }
  
    const proofUrl = order.paymentProofUrl;
  
    // Si es URL de Supabase, generar signed URL fresca y redirigir
    if (proofUrl.includes("supabase")) {
      const storagePath = this.uploadService.extractPathFromUrl(proofUrl);
      if (!storagePath) {
        throw new NotFoundException("No se pudo extraer la ruta del archivo de Supabase");
      }
      const signedUrl = await this.uploadService.getSignedUrl(storagePath);
      return res.redirect(signedUrl);
    }
  
    // Fallback: servir archivo local (legacy)
    // URL format: http://host/uploads/private/concert/payments/filename.jpg
    const urlParts = proofUrl.split("/uploads/");
    if (urlParts.length < 2) {
      throw new NotFoundException("Ruta de archivo invalida");
    }
    const relativePath = urlParts[1];
    const filePath = path.join(process.cwd(), "uploads", relativePath);
  
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException("Archivo no encontrado en el servidor");
    }
  
    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";
  
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${path.basename(filePath)}"`,
    );
    return res.sendFile(filePath);
  }
  
  @Delete("orders/:id/proof")
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  async deleteOrderProof(
    @Param("id", ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.concertService.deletePaymentProof(id, organizationId);
  }
}
