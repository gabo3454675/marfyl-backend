/**
 * AI Module - Marfyl Gemini Integration
 *
 * This module provides the ChatHandler with all required service dependencies
 * for executing Gemini function calls against backend services.
 */

import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { ActivityLogModule } from "@/modules/activity-log/activity-log.module";
import { InvoicesModule } from "@/modules/invoices/invoices.module";
import { ConcertModule } from "@/modules/concert/concert.module";
import { FiscalModule } from "@/modules/fiscal/fiscal.module";
import { ProductsModule } from "@/modules/products/products.module";
import { DashboardModule } from "@/modules/dashboard/dashboard.module";
import { CustomersModule } from "@/modules/customers/customers.module";
import { ExpensesModule } from "@/modules/expenses/expenses.module";
import { SuppliersModule } from "@/modules/suppliers/suppliers.module";
import { CreditsModule } from "@/modules/credits/credits.module";

import { ChatHandler } from "@/ai/chatHandler";
import { WebSocketService } from "@/services/websocket";

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ActivityLogModule,
    InvoicesModule,
    ConcertModule,
    FiscalModule,
    ProductsModule,
    DashboardModule,
    CustomersModule,
    ExpensesModule,
    SuppliersModule,
    CreditsModule,
  ],
  providers: [ChatHandler, WebSocketService],
  exports: [ChatHandler, WebSocketService],
})
export class AiModule {}
