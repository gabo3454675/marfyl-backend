import { Body, Controller, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { FiscalAdvisorContextService } from "./fiscal-advisor-context.service";
import { FiscalAdvisorService } from "./fiscal-advisor.service";
import { FiscalAdvisorDto } from "./dto/fiscal-advisor.dto";

@Controller("assistant")
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class FiscalAdvisorController {
  constructor(
    private readonly advisor: FiscalAdvisorService,
    private readonly context: FiscalAdvisorContextService,
  ) {}

  @Post("advisor/stream")
  async advisorStream(
    @Body() dto: FiscalAdvisorDto,
    @Req()
    req: {
      activeOrganizationId?: number;
      activeOrganization?: { id?: number };
    },
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const organizationId =
      req.activeOrganizationId ?? req.activeOrganization?.id ?? 0;

    try {
      const auto = organizationId
        ? await this.context.buildForOrganization(Number(organizationId))
        : null;

      const payload: FiscalAdvisorDto = {
        mensajeUsuario: dto.mensajeUsuario,
        perfilEmpresa: {
          ...auto?.perfilEmpresa,
          ...dto.perfilEmpresa,
        },
        resumenOperativo: {
          ...auto?.resumenOperativo,
          ...dto.resumenOperativo,
          ultimaDeclaracionIVA:
            dto.resumenOperativo?.ultimaDeclaracionIVA ??
            (auto?.resumenOperativo.ultimaDeclaracionIVA instanceof Date
              ? auto.resumenOperativo.ultimaDeclaracionIVA.toISOString()
              : auto?.resumenOperativo.ultimaDeclaracionIVA ?? null),
        },
      };

      for await (const event of this.advisor.adviseStream(payload)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    }

    res.end();
  }
}
