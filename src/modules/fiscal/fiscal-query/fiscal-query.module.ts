import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { FiscalQueryController } from "./fiscal-query.controller";
import { FiscalQueryCatalogController } from "./fiscal-query-catalog.controller";
import { FiscalQueryService } from "./fiscal-query.service";
import { FiscalAuditLogger } from "./audit/fiscal-audit.logger";
import { FiscalRateLimitGuard } from "./rate-limit/fiscal-rate-limit.guard";

/**
 * Submódulo del endpoint `POST /api/fiscal/query` (queries fiscales
 * parametrizadas con allow-list) y `GET /api/fiscal/query/catalog`
 * (catálogo versionado para drift check del agente). Se importa desde
 * `FiscalModule`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [FiscalQueryController, FiscalQueryCatalogController],
  providers: [FiscalQueryService, FiscalAuditLogger, FiscalRateLimitGuard],
})
export class FiscalQueryModule {}
