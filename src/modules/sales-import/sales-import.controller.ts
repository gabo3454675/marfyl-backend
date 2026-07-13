import {
  Controller,
  Post,
  Body,
  UseGuards,
  UploadedFiles,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { SalesImportService } from "./sales-import.service";
import { ConfirmSalesImportDto } from "./dto/confirm-sales-import.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";

@Controller("sales-import")
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
export class SalesImportController {
  constructor(private readonly salesImportService: SalesImportService) {}

  @Post("preview")
  @Permissions("canManageInventory")
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async preview(
    @UploadedFiles() files: Express.Multer.File[],
    @ActiveOrganization() organizationId?: number,
  ) {
    if (!files?.length) {
      throw new BadRequestException("Al menos un archivo requerido");
    }
    return this.salesImportService.previewFromBuffers({
      organizationId: organizationId!,
      files,
    });
  }

  @Post("provision-missing")
  @Permissions("canManageInventory")
  @UseInterceptors(
    FilesInterceptor("files", 10, {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async provisionMissing(
    @UploadedFiles() files: Express.Multer.File[],
    @ActiveOrganization() organizationId?: number,
  ) {
    if (!files?.length) {
      throw new BadRequestException("Al menos un archivo requerido");
    }
    return this.salesImportService.provisionMissingProductsFromBuffers({
      organizationId: organizationId!,
      files,
    });
  }

  @Post("confirm")
  @Permissions("canManageInventory")
  async confirm(
    @Body() dto: ConfirmSalesImportDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.salesImportService.confirm({
      organizationId,
      userId: user.id,
      batchId: dto.batchId,
      allowWarnings: dto.allowWarnings,
      skipStockValidation: dto.skipStockValidation ?? false,
    });
  }
}
