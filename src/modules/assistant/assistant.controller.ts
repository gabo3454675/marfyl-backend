import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import {
  buildDevPreviewUser,
  devPreviewAgentUserId,
  isDevPreviewAuthEnabled,
} from "@/common/dev-preview";
import { AssistantService } from "./assistant.service";
import { AssistantToolsService } from "./assistant-tools.service";
import { AssistantChatDto } from "./dto/chat.dto";

type AssistantRequest = {
  user?: { sub?: number; id?: number };
  activeOrganization?: { id?: number; nombre?: string };
  activeOrganizationId?: number;
  activeOrganizationMembership?: { role?: string };
  headers?: { authorization?: string };
};

@Controller("assistant")
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AssistantController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly tools: AssistantToolsService,
  ) {}

  private buildContext(req: AssistantRequest) {
    const organizationId =
      req.activeOrganizationId ?? req.activeOrganization?.id;
    // JwtStrategy expone `id` (no `sub`). Preferir id.
    let userId = Number(req.user?.id ?? req.user?.sub ?? 0);
    // Vista previa usa id=0 (reservado); el agente Python exige userId > 0.
    if (
      userId === 0 &&
      isDevPreviewAuthEnabled() &&
      req.user?.id === buildDevPreviewUser().id
    ) {
      userId = devPreviewAgentUserId();
    }
    const userRole = req.activeOrganizationMembership?.role;
    const authorization =
      typeof req.headers?.authorization === "string"
        ? req.headers.authorization
        : undefined;
    return {
      organizationId: Number(organizationId),
      userId,
      orgName: req.activeOrganization?.nombre,
      userRole: userRole ? String(userRole) : undefined,
      authorization,
    };
  }

  @Get("ops-briefing")
  opsBriefing(@Req() req: AssistantRequest) {
    return this.tools.getOpsBriefing(this.buildContext(req));
  }

  @Get("cash-status")
  cashStatus(@Req() req: AssistantRequest) {
    return this.tools.getCashRegisterStatus(this.buildContext(req));
  }

  @Get("restock-suggestions")
  restockSuggestions(
    @Req() req: AssistantRequest,
    @Query("limit") limit?: string,
  ) {
    const parsed = limit ? Number(limit) : 12;
    return this.tools.suggestRestock(
      { limit: Number.isFinite(parsed) ? parsed : 12 },
      this.buildContext(req),
    );
  }

  @Post("chat")
  async chat(@Body() dto: AssistantChatDto, @Req() req: AssistantRequest) {
    return this.assistant.chat(dto, this.buildContext(req));
  }

  @Post("chat/stream")
  async chatStream(
    @Body() dto: AssistantChatDto,
    @Req() req: AssistantRequest,
    @Res() res: Response,
  ) {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const context = this.buildContext(req);

    try {
      for await (const event of this.assistant.chatStream(dto, context)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      res.write(`data: ${JSON.stringify({ type: "error", message })}\n\n`);
    }

    res.end();
  }
}
