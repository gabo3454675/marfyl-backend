import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { FiscalKnowledgeService } from "./fiscal-knowledge.service";

@Module({
  imports: [PrismaModule],
  providers: [FiscalKnowledgeService],
  exports: [FiscalKnowledgeService],
})
export class FiscalKnowledgeModule {}
