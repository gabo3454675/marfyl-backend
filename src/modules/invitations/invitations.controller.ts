import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ProvisionMemberDto } from './dto/provision-member.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';

@Controller('invitations')
@UseGuards(JwtAuthGuard, OrganizationGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  /** Invitación por link (genera token y URL; no crea usuario hasta aceptar). */
  @Post()
  async inviteMember(
    @Body() inviteDto: InviteMemberDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
  ) {
    return this.invitationsService.inviteMember(
      inviteDto,
      organizationId,
      user.id,
    );
  }

  /** Provisionamiento interno: crea usuario y/o lo agrega a la organización sin email. */
  @Post('provision')
  async provisionMember(
    @Body() dto: ProvisionMemberDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
  ) {
    return this.invitationsService.provisionMember(
      dto,
      organizationId,
      user.id,
    );
  }

  @Post('accept/:token')
  @UseGuards(JwtAuthGuard) // No requiere OrganizationGuard porque aún no es miembro
  async acceptInvitation(
    @Param('token') token: string,
    @ActiveUser() user: any,
  ) {
    return this.invitationsService.acceptInvitation(token, user.id);
  }

  @Get()
  async getInvitations(
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: any,
  ) {
    return this.invitationsService.getOrganizationInvitations(
      organizationId,
      user.id,
    );
  }

  @Get('members')
  async getMembers(@ActiveOrganization() organizationId: number) {
    return this.invitationsService.getOrganizationMembers(organizationId);
  }
}
