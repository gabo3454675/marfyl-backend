import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { Public } from "@/common/decorators/public.decorator";
import { ConcertService } from "./concert.service";
import { HoldSeatsDto } from "./dto/hold-seats.dto";
import { ConcertCheckoutDto } from "./dto/checkout.dto";

@Controller("concert/public")
export class ConcertPublicController {
  constructor(private readonly concertService: ConcertService) {}

  @Public()
  @Get(":slug")
  getEvent(@Param("slug") slug: string) {
    return this.concertService.getPublicEvent(slug);
  }

  @Public()
  @Throttle({ long: { limit: 10, ttl: 60000 } })
  @Post(":slug/hold")
  holdSeats(@Param("slug") slug: string, @Body() dto: HoldSeatsDto) {
    return this.concertService.holdSeats(slug, dto.seatIds);
  }

  @Public()
  @Throttle({ long: { limit: 5, ttl: 60000 } })
  @Post(":slug/checkout")
  @UseInterceptors(
    FileInterceptor("paymentProof", {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  checkout(
    @Param("slug") slug: string,
    @Body() dto: ConcertCheckoutDto,
    @UploadedFile() paymentProof?: Express.Multer.File,
  ) {
    return this.concertService.checkoutPublic(slug, dto, paymentProof);
  }

  @Public()
  @Get(":slug/boleto/:ticketToken")
  getTicket(
    @Param("slug") slug: string,
    @Param("ticketToken") ticketToken: string,
  ) {
    return this.concertService.getPublicTicket(slug, ticketToken);
  }

  @Throttle({ long: { limit: 30, ttl: 60000 } })
  @Public()
  @Get(":slug/orden/:orderToken")
  getOrder(
    @Param("slug") slug: string,
    @Param("orderToken") orderToken: string,
  ) {
    return this.concertService.getPublicOrder(slug, orderToken);
  }
}
