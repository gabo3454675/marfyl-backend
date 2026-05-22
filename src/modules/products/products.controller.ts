import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CacheTTL } from '@nestjs/cache-manager';
import { HttpCacheTenantInterceptor } from '@/common/interceptors/http-cache-tenant.interceptor';
import { ActiveUser } from '@/common/decorators/active-user.decorator';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';

@Controller('products')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image'))
  async create(
    @Body() createProductDto: CreateProductDto,
    @ActiveOrganization() organizationId: number,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    let imageUrl: string | undefined;

    if (image) {
      imageUrl = await this.productsService.uploadImage(image);
    }

    return this.productsService.create(createProductDto, organizationId, imageUrl);
  }

  @Get()
  @UseInterceptors(HttpCacheTenantInterceptor)
  @CacheTTL(60)
  findAll(@ActiveOrganization() organizationId: number) {
    return this.productsService.findAll(organizationId);
  }

  @Get('barcode/:barcode')
  findByBarcode(
    @Param('barcode') barcode: string,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.productsService.findByBarcode(barcode, organizationId);
  }

  /**
   * Productos con stock por debajo del mínimo (alertas de inventario).
   */
  @Get('alertas-stock')
  getAlertasStock(@ActiveOrganization() organizationId: number) {
    return this.productsService.getAlertasStock(organizationId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.productsService.findOne(id, organizationId);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateProductDto: UpdateProductDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user?: { id: number },
  ) {
    return this.productsService.update(id, updateProductDto, organizationId, user?.id);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveOrganization() organizationId: number,
  ) {
    return this.productsService.remove(id, organizationId);
  }

  @Post('upload-excel')
  @UseInterceptors(FileInterceptor('file'))
  async uploadExcel(
    @UploadedFile() file: Express.Multer.File,
    @ActiveOrganization() organizationId: number,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo no proporcionado');
    }

    // Validar tipo de archivo
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/octet-stream', // Algunos navegadores envían esto para .xlsx
    ];

    const allowedExtensions = ['.xlsx', '.xls'];
    const fileExtension = file.originalname
      .toLowerCase()
      .substring(file.originalname.lastIndexOf('.'));

    if (
      !allowedMimeTypes.includes(file.mimetype) &&
      !allowedExtensions.includes(fileExtension)
    ) {
      throw new BadRequestException(
        'El archivo debe ser un Excel (.xlsx o .xls). Tipo recibido: ' + file.mimetype
      );
    }

    return this.productsService.importFromExcel(file, organizationId);
  }
}
