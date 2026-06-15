import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { FiscalKnowledgeModule } from "@/modules/fiscal-knowledge/fiscal-knowledge.module";
import { FiscalAdvisorController } from "./fiscal-advisor.controller";
import { FiscalAdvisorService } from "./fiscal-advisor.service";
import { FiscalAdvisorContextService } from "./fiscal-advisor-context.service";

@Module({
  imports: [PrismaModule, FiscalKnowledgeModule],
  controllers: [FiscalAdvisorController],
  providers: [FiscalAdvisorService, FiscalAdvisorContextService],
  exports: [FiscalAdvisorService],
})
export class FiscalAdvisorModule {}
