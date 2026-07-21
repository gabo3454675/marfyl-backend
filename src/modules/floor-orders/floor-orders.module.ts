import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { InvoicesModule } from "@/modules/invoices/invoices.module";
import { AiModule } from "@/modules/ai/ai.module";
import { FloorOrdersController } from "./floor-orders.controller";
import { FloorOrdersService } from "./floor-orders.service";
import { AnyPermissionsGuard } from "@/common/guards/any-permissions.guard";

@Module({
  imports: [PrismaModule, InvoicesModule, AiModule],
  controllers: [FloorOrdersController],
  providers: [FloorOrdersService, AnyPermissionsGuard],
  exports: [FloorOrdersService],
})
export class FloorOrdersModule {}
