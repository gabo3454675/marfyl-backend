import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { AuthModule } from "@/modules/auth/auth.module";
import { InvoicesModule } from "@/modules/invoices/invoices.module";
import { DashboardModule } from "@/modules/dashboard/dashboard.module";
import { ProductsModule } from "@/modules/products/products.module";
import { ConcertModule } from "@/modules/concert/concert.module";
import { FiscalModule } from "@/modules/fiscal/fiscal.module";
import { ExpensesModule } from "@/modules/expenses/expenses.module";
import { CierreCajaModule } from "@/modules/cierre-caja/cierre-caja.module";
import { InventoryModule } from "@/modules/inventory/inventory.module";
import { CustomersModule } from "@/modules/customers/customers.module";
import { FiscalKnowledgeModule } from "@/modules/fiscal-knowledge/fiscal-knowledge.module";
import { AssistantController } from "./assistant.controller";
import { AssistantService } from "./assistant.service";
import { AssistantToolsService } from "./assistant-tools.service";
import { AssistantSecurityService } from "./assistant-security.service";
import { AssistantLocalFallbackService } from "./assistant-local-fallback.service";
import { AgentProxyService } from "./agent-proxy.service";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    InvoicesModule,
    DashboardModule,
    ProductsModule,
    ConcertModule,
    FiscalModule,
    ExpensesModule,
    CierreCajaModule,
    InventoryModule,
    CustomersModule,
    FiscalKnowledgeModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    AgentProxyService,
    AssistantToolsService,
    AssistantSecurityService,
    AssistantLocalFallbackService,
  ],
  exports: [AssistantService],
})
export class AssistantModule {}
