import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { PurchasesImportController } from "./purchases-import.controller";
import { PurchasesImportService } from "./purchases-import.service";

@Module({
  imports: [PrismaModule],
  controllers: [PurchasesImportController],
  providers: [PurchasesImportService],
  exports: [PurchasesImportService],
})
export class PurchasesImportModule {}
