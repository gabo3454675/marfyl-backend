import { Module } from '@nestjs/common';
import { HybridImportController } from './hybrid-import.controller';
import { HybridImportService } from './hybrid-import.service';
import { EntityResolverService } from './services/entity-resolver.service';
import { VentaAdapter } from './adapters/venta.adapter';
import { ProductoAdapter } from './adapters/producto.adapter';
import { ClienteAdapter } from './adapters/cliente.adapter';
import { PrismaModule } from '@/common/prisma/prisma.module';
import { HybridModule } from '../hybrid/hybrid.module';

@Module({
  imports: [PrismaModule, HybridModule],
  controllers: [HybridImportController],
  providers: [
    HybridImportService,
    EntityResolverService,
    VentaAdapter,
    ProductoAdapter,
    ClienteAdapter,
  ],
  exports: [HybridImportService],
})
export class HybridImportModule {}
