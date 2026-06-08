import { Module } from "@nestjs/common";
import { UploadModule } from "@/common/services/upload.module";
import { EmailModule } from "@/modules/email/email.module";
import { ConcertService } from "./concert.service";
import { ConcertController } from "./concert.controller";
import { ConcertPublicController } from "./concert-public.controller";
import { ConcertBootstrapService } from "./concert-bootstrap.service";

@Module({
  imports: [UploadModule, EmailModule],
  controllers: [ConcertController, ConcertPublicController],
  providers: [ConcertService, ConcertBootstrapService],
  exports: [ConcertService],
})
export class ConcertModule {}
