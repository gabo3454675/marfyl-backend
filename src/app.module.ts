import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { CacheModule } from "@nestjs/cache-manager";
import { HttpCacheTenantInterceptor } from "./common/interceptors/http-cache-tenant.interceptor";
import { TenantContextInterceptor } from "./common/interceptors/tenant-context.interceptor";
import { ScheduleModule } from "@nestjs/schedule";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./common/prisma/prisma.module";
import { BillingModule } from "./common/billing/billing.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { AuthModule } from "./modules/auth/auth.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { CustomersModule } from "./modules/customers/customers.module";
import { InvoicesModule } from "./modules/invoices/invoices.module";
import { InventoryModule } from "./modules/inventory/inventory.module";
import { ProductsModule } from "./modules/products/products.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { SuppliersModule } from "./modules/suppliers/suppliers.module";
import { ExpensesModule } from "./modules/expenses/expenses.module";
import { ExpenseCategoriesModule } from "./modules/expense-categories/expense-categories.module";
import { InvitationsModule } from "./modules/invitations/invitations.module";
import { TasksModule } from "./modules/tasks/tasks.module";
import { CreditsModule } from "./modules/credits/credits.module";
import { BackupModule } from "./modules/backup/backup.module";
import { CierreCajaModule } from "./modules/cierre-caja/cierre-caja.module";
import { ActivityLogModule } from "./modules/activity-log/activity-log.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { AuditoriaModule } from "./common/auditoria/auditoria.module";
import { FiscalModule } from "./modules/fiscal/fiscal.module";
import { AssistantModule } from "./modules/assistant/assistant.module";
import { ConcertModule } from "./modules/concert/concert.module";
import { EmailModule } from "./modules/email/email.module";
import { HealthModule } from "./modules/health/health.module";
import { AiModule } from "./modules/ai/ai.module";
import { FiscalAdvisorModule } from "./modules/fiscal-advisor/fiscal-advisor.module";
import { ExchangeRateModule } from "./modules/exchange-rate/exchange-rate.module";
import { PlanModule } from "./modules/plan/plan.module";
import { PayrollModule } from "./modules/payroll/payroll.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", ".env.txt"],
    }),
    ScheduleModule.forRoot(),
    CacheModule.register({
      ttl: 60,
      max: 500,
      isGlobal: true,
    }),
    PrismaModule,
    BillingModule,
    AuthModule,
    TenantsModule,
    CustomersModule,
    InvoicesModule,
    InventoryModule,
    ProductsModule,
    DashboardModule,
    SuppliersModule,
    ExpensesModule,
    ExpenseCategoriesModule,
    InvitationsModule,
    TasksModule,
    CreditsModule,
    BackupModule,
    CierreCajaModule,
    ActivityLogModule,
    NotificationsModule,
    AuditoriaModule,
    FiscalModule,
    AssistantModule,
    FiscalAdvisorModule,
    EmailModule,
    ConcertModule,
    HealthModule,
    AiModule,
    ExchangeRateModule,
    PlanModule,
    PayrollModule,
    ThrottlerModule.forRoot([
      {
        name: "short",
        ttl: 1000, // 1 second
        limit: 3,
      },
      {
        name: "medium",
        ttl: 10000, // 10 seconds
        limit: 20,
      },
      {
        name: "long",
        ttl: 60000, // 1 minute
        limit: 100,
      },
    ]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpCacheTenantInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
