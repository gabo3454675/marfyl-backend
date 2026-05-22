import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PrismaModule } from '@/common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService, RolesGuard],
  exports: [TenantsService],
})
export class TenantsModule {}
