import { Module } from '@nestjs/common';
import { UploadModule } from '@/common/services/upload.module';
import { ConcertService } from './concert.service';
import { ConcertController } from './concert.controller';
import { ConcertPublicController } from './concert-public.controller';

@Module({
  imports: [UploadModule],
  controllers: [ConcertController, ConcertPublicController],
  providers: [ConcertService],
  exports: [ConcertService],
})
export class ConcertModule {}
