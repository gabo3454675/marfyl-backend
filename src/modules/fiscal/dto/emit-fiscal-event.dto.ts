import { FiscalDomainEventType } from "@prisma/client";
import { IsEnum, IsObject, IsOptional, IsString } from "class-validator";

export class EmitFiscalEventDto {
  @IsEnum(FiscalDomainEventType)
  eventType!: FiscalDomainEventType;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
