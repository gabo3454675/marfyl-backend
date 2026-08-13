import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { FiscalKnowledgeController } from "./fiscal-knowledge.controller";
import { FiscalKnowledgeService } from "./fiscal-knowledge.service";

@Module({
  imports: [PrismaModule],
  controllers: [FiscalKnowledgeController],
  providers: [FiscalKnowledgeService],
  exports: [FiscalKnowledgeService],
})
export class FiscalKnowledgeModule {}
