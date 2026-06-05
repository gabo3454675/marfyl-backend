import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { ActivityLogModule } from "@/modules/activity-log/activity-log.module";
import { InvoicesController } from "./invoices.controller";
import { InvoicesPublicController } from "./invoices-public.controller";
import { InvoicesService } from "./invoices.service";
import { CreditsModule } from "../credits/credits.module";
import { TasksModule } from "../tasks/tasks.module";
import { FiscalModule } from "../fiscal/fiscal.module";

@Module({
  imports: [
    PrismaModule,
    CreditsModule,
    TasksModule,
    ActivityLogModule,
    FiscalModule,
  ],
  controllers: [InvoicesController, InvoicesPublicController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
