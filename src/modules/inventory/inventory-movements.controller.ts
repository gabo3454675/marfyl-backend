import { Controller, Post, Get, UseGuards, UseInterceptors, Body, Query, Res, BadRequestException, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Response } from "express";
import { InventoryMovementsService } from "./inventory-movements.service";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { PermissionsGuard } from "@/common/guards/permissions.guard";
import { Permissions } from "@/common/decorators/permissions.decorator";
import { ActiveOrganization } from "@/common/decorators/active-organization.decorator";
import { ActiveUser } from "@/common/decorators/active-user.decorator";
import { CreateMovementDto } from "./dto/create-movement.dto";
import { CreateAdjustmentDto } from "./dto/create-adjustment.dto";
import { MovementType } from "@prisma/client";

@Controller("inventory/movements")
@UseGuards(JwtAuthGuard, OrganizationGuard, PermissionsGuard)
export class InventoryMovementsController {
  constructor(
    private readonly inventoryMovementsService: InventoryMovementsService,
  ) {}

  /**
   * Registra una salida por Autoconsumo o Merma (vencido/dañado).
   * Descuenta del stock del producto y crea el registro en InventoryMovement.
   */
  @Post()
  @Permissions("canManageInventory")
  async create(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: CreateMovementDto,
  ) {
    return this.inventoryMovementsService.createOutflow({
      organizationId,
      userId: user.id,
      dto,
    });
  }

  /**
   * Ajuste de stock sin impacto financiero (sin Invoice / Expense).
   */
  @Post("adjust")
  @Permissions("canManageInventory")
  async adjust(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
    @Body() dto: CreateAdjustmentDto,
  ) {
    return this.inventoryMovementsService.createAdjustment({
      organizationId,
      userId: user.id,
      productId: dto.productId,
      delta: dto.delta,
      reason: dto.reason,
    });
  }

  /**
   * Importa consumos/autoconsumos masivamente desde Excel.
   * confirm=false: preview (dry-run). confirm=true: ejecuta.
   */
  @Post("import")
  @Permissions("canManageInventory")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async importConsumptions(
    @UploadedFile() file: Express.Multer.File,
    @Body("confirm") confirm: string | boolean,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    if (!file) {
      throw new BadRequestException("Archivo requerido");
    }
    const confirmBool =
      confirm === true ||
      String(confirm || "").toLowerCase().trim() === "true";
    return this.inventoryMovementsService.importConsumptionsFromExcel({
      file,
      organizationId,
      userId: user.id,
      confirm: confirmBool,
    });
  }

  /**
   * KPIs para dashboard de Autoconsumo: impacto económico por día, productos más consumidos, distribución por motivo.
   * Query opcionales: dateFrom, dateTo (YYYY-MM-DD).
   */
  @Get("kpis")
  async getKpis(
    @ActiveOrganization() organizationId: number,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
  ) {
    return this.inventoryMovementsService.getAutoconsumoKpis(organizationId, {
      dateFrom,
      dateTo,
    });
  }

  /**
   * Descarga plantilla Excel para carga masiva de consumos/autoconsumo.
   */
  @Get("template")
  @Permissions("canManageInventory")
  async downloadTemplate(@Res() res: Response) {
    const buffer =
      await this.inventoryMovementsService.generateConsumptionTemplateBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="consumo-plantilla.xlsx"',
    );
    res.send(buffer);
  }

  /**
   * Lista movimientos de inventario de la organización.
   * Query opcionales: productId, type (MovementType), limit.
   */
  @Get()
  async findAll(
    @ActiveOrganization() organizationId: number,
    @Query("productId") productId?: string,
    @Query("type") type?: string,
    @Query("limit") limit?: string,
  ) {
    const options: { productId?: number; type?: MovementType; limit?: number } =
      {};
    if (productId != null && productId !== "") {
      const n = parseInt(productId, 10);
      if (!Number.isNaN(n)) options.productId = n;
    }
    if (type != null && type !== "") options.type = type as MovementType;
    if (limit != null && limit !== "") {
      const n = parseInt(limit, 10);
      if (!Number.isNaN(n)) options.limit = n;
    }
    return this.inventoryMovementsService.findByOrganization(
      organizationId,
      options,
    );
  }
}
