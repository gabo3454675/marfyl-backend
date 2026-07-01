import { Controller, Get, Post, Body, Query, UseGuards, UploadedFile, UseInterceptors, BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { InvoiceUploadService } from "./invoice-upload.service";
import { ConfirmInvoiceUploadDto } from "./dto/confirm-invoice.dto";
import { InvoiceUploadHistoryDto } from "./dto/invoice-upload-history.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";

@Controller("invoice-upload")
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
export class InvoiceUploadController {
  constructor(private readonly invoiceUploadService: InvoiceUploadService) {}

  @Post("preview")
  @Permissions("canManageInventory")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async preview(
    @UploadedFile() file: Express.Multer.File,
    @Body("supplierId") rawSupplierId?: string,
    @ActiveOrganization() organizationId?: number,
  ) {
    if (!file) {
      throw new BadRequestException("Archivo requerido");
    }
    let supplierId: number | undefined;
    if (rawSupplierId != null && String(rawSupplierId).trim() !== "") {
      const n = parseInt(String(rawSupplierId), 10);
      if (Number.isFinite(n)) supplierId = n;
    }
    return this.invoiceUploadService.preview({
      file,
      organizationId: organizationId!,
      supplierId,
    });
  }

  @Post("confirm")
  @Permissions("canManageInventory")
  async confirm(
    @Body() dto: ConfirmInvoiceUploadDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { sub: number },
  ) {
    return this.invoiceUploadService.confirm({
      organizationId,
      userId: user.sub,
      dto,
    });
  }

  @Get("products/search")
  @Permissions("canManageInventory")
  async searchProducts(
    @Query("q") query: string,
    @Query("limit") limitStr: string,
    @ActiveOrganization() organizationId: number,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    return this.invoiceUploadService.searchProducts(organizationId, query || "", limit);
  }

  @Get("history")
  @Permissions("canManageInventory")
  async getHistory(
    @Query() query: InvoiceUploadHistoryDto,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.invoiceUploadService.getHistory(organizationId, query);
  }
}
