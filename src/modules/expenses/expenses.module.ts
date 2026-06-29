import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { FiscalModule } from "@/modules/fiscal/fiscal.module";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";
import { ReceiptScanService } from "./receipt-scan.service";

@Module({
  imports: [PrismaModule, FiscalModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, ReceiptScanService],
  exports: [ExpensesService, ReceiptScanService],
})
export class ExpensesModule {}
