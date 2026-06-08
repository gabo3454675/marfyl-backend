import { Module } from "@nestjs/common";
import { OrganizationProvisioningService } from "./organization-provisioning.service";

@Module({
  providers: [OrganizationProvisioningService],
  exports: [OrganizationProvisioningService],
})
export class ProvisioningModule {}
