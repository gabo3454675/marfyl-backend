import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { ActivityLogModule } from "@/modules/activity-log/activity-log.module";
import { InvoiceUploadController } from "./invoice-upload.controller";
import { InvoiceUploadService } from "./invoice-upload.service";
import { InvoiceUploadHistoryService } from "./invoice-upload-history.service";

@Module({
  imports: [PrismaModule, ActivityLogModule],
  controllers: [InvoiceUploadController],
  providers: [InvoiceUploadService, InvoiceUploadHistoryService],
  exports: [InvoiceUploadService, InvoiceUploadHistoryService],
})
export class InvoiceUploadModule {}
