import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { FiscalKnowledgeService } from "./fiscal-knowledge.service";
import { FiscalKnowledgeController } from "./fiscal-knowledge.controller";

@Module({
  imports: [PrismaModule],
  controllers: [FiscalKnowledgeController],
  providers: [FiscalKnowledgeService],
  exports: [FiscalKnowledgeService],
})
export class FiscalKnowledgeModule {}
