import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { FiscalKnowledgeModule } from "@/modules/fiscal-knowledge/fiscal-knowledge.module";
import { MarfylAIService } from "@/services/marfylAI";
import { FiscalAdvisorController } from "./fiscal-advisor.controller";
import { FiscalAdvisorService } from "./fiscal-advisor.service";
import { FiscalAdvisorContextService } from "./fiscal-advisor-context.service";

@Module({
  imports: [PrismaModule, FiscalKnowledgeModule],
  controllers: [FiscalAdvisorController],
  providers: [FiscalAdvisorService, FiscalAdvisorContextService, MarfylAIService],
  exports: [FiscalAdvisorService, MarfylAIService],
})
export class FiscalAdvisorModule {}
