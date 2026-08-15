import { Module } from "@nestjs/common";
import { HybridController } from "./hybrid.controller";
import { HybridService } from "./hybrid.service";
import { HybridHttpClient } from "./hybrid-http.client";

@Module({
  controllers: [HybridController],
  providers: [HybridService, HybridHttpClient],
  exports: [HybridService],
})
export class HybridModule {}
