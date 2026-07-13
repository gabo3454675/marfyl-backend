import {
  Controller,
  Post,
  Body,
  UseGuards,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { PurchasesImportService } from "./purchases-import.service";
import { ConfirmPurchasesImportDto } from "./dto/confirm-purchases-import.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";

const EXCEL_EXTENSIONS = /\.(xlsx|xls)$/i;

function assertExcelUpload(file: Express.Multer.File) {
  if (!file?.buffer?.length) {
    throw new BadRequestException("Archivo requerido");
  }
  if (!EXCEL_EXTENSIONS.test(file.originalname ?? "")) {
    throw new BadRequestException("Solo archivos Excel (.xlsx, .xls)");
  }
}

@Controller("purchases-import")
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
export class PurchasesImportController {
  constructor(private readonly purchasesImportService: PurchasesImportService) {}

  @Post("preview")
  @Permissions("canManageInventory")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async preview(
    @UploadedFile() file: Express.Multer.File,
    @ActiveOrganization() organizationId: number,
  ) {
    assertExcelUpload(file);
    return this.purchasesImportService.preview({
      buffer: file.buffer,
      fileName: file.originalname,
      organizationId,
    });
  }

  @Post("confirm")
  @Permissions("canManageInventory")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async confirm(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: ConfirmPurchasesImportDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    assertExcelUpload(file);
    const skipImported =
      dto.skipImported !== false && String(dto.skipImported) !== "false";
    return this.purchasesImportService.confirm({
      buffer: file.buffer,
      fileName: file.originalname,
      organizationId,
      userId: user.id,
      skipImported,
    });
  }
}
