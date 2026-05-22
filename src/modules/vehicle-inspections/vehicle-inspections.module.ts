import { Module } from '@nestjs/common';
import { VehicleInspectionsController } from './vehicle-inspections.controller';
import { VehicleInspectionsService } from './vehicle-inspections.service';
import { CompanyAccessGuard } from '@/common/guards/company-access.guard';

@Module({
  controllers: [VehicleInspectionsController],
  providers: [VehicleInspectionsService, CompanyAccessGuard],
  exports: [VehicleInspectionsService],
})
export class VehicleInspectionsModule {}
