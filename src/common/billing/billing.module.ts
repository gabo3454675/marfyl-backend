import { Global, Module } from '@nestjs/common';
import { OrganizationBillingService } from './organization-billing.service';

@Global()
@Module({
  providers: [OrganizationBillingService],
  exports: [OrganizationBillingService],
})
export class BillingModule {}
