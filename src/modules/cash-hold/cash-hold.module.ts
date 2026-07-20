import { Module } from "@nestjs/common";
import { PrismaModule } from "@/common/prisma/prisma.module";
import { CashHoldController } from "./cash-hold.controller";
import { CashHoldService } from "./cash-hold.service";

@Module({
  imports: [PrismaModule],
  controllers: [CashHoldController],
  providers: [CashHoldService],
  exports: [CashHoldService],
})
export class CashHoldModule {}
