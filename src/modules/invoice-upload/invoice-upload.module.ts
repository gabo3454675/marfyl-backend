import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { ActivityLogModule } from "@/modules/activity-log/activity-log.module";
import { InvoiceUploadController } from "./invoice-upload.controller";
import { InvoiceUploadService } from "./invoice-upload.service";
import { InvoiceUploadHistoryService } from "./invoice-upload-history.service";
import { ExpensesModule } from "@/modules/expenses/expenses.module";

@Module({
  imports: [PrismaModule, ActivityLogModule, ExpensesModule],
  controllers: [InvoiceUploadController],
  providers: [InvoiceUploadService, InvoiceUploadHistoryService],
  exports: [InvoiceUploadService, InvoiceUploadHistoryService],
})
export class InvoiceUploadModule {}
