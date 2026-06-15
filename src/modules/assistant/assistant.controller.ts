import { Body, Controller, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { AssistantService } from "./assistant.service";
import { AssistantChatDto } from "./dto/chat.dto";

@Controller("assistant")
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  private buildContext(
    req: {
      user?: { sub?: number; id?: number };
      activeOrganization?: { id?: number; nombre?: string };
      activeOrganizationId?: number;
    },
  ) {
    const organizationId =
      req.activeOrganizationId ?? req.activeOrganization?.id;
    const userId = req.user?.sub ?? req.user?.id ?? 0;
    return {
      organizationId: Number(organizationId),
      userId: Number(userId),
      orgName: req.activeOrganization?.nombre,
    };
  }

  @Post("chat")
  async chat(
    @Body() dto: AssistantChatDto,
    @Req()
    req: {
      user?: { sub?: number; id?: number };
      activeOrganization?: { id?: number; nombre?: string };
      activeOrganizationId?: number;
    },
  ) {
    return this.assistant.chat(dto, this.buildContext(req));
  }

  @Post("chat/stream")
  async chatStream(
    @Body() dto: AssistantChatDto,
    @Req()
    req: {
      user?: { sub?: number; id?: number };
      activeOrganization?: { id?: number; nombre?: string };
      activeOrganizationId?: number;
    },
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
