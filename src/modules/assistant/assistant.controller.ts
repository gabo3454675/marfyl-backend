import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { AssistantService } from './assistant.service';
import { AssistantChatDto } from './dto/chat.dto';

@Controller('assistant')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @Post('chat')
  async chat(@Body() dto: AssistantChatDto, @Req() req: { activeOrganization?: { nombre?: string } }) {
    const orgName = req.activeOrganization?.nombre;
    return this.assistant.chat(dto, orgName);
  }
}
