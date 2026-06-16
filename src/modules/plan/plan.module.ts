import { Module, Global } from '@nestjs/common';
import { PlanLimitsService } from './limits.service';

@Global()
@Module({
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanModule {}