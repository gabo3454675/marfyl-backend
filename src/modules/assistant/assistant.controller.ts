import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { OrganizationGuard } from "@/common/guards/organization.guard";
import { AssistantService } from "./assistant.service";
import { AssistantChatDto } from "./dto/chat.dto";

@Controller("assistant")
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

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
    const organizationId =
      req.activeOrganizationId ?? req.activeOrganization?.id;
    const userId = req.user?.sub ?? req.user?.id ?? 0;

    return this.assistant.chat(dto, {
      organizationId: Number(organizationId),
      userId: Number(userId),
      orgName: req.activeOrganization?.nombre,
    });
  }
}
