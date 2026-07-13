import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { InvoicesModule } from "@/modules/invoices/invoices.module";
import { SalesImportController } from "./sales-import.controller";
import { SalesImportService } from "./sales-import.service";

@Module({
  imports: [PrismaModule, InvoicesModule],
  controllers: [SalesImportController],
  providers: [SalesImportService],
  exports: [SalesImportService],
})
export class SalesImportModule {}
