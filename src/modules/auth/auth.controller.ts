import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { Public } from "@/common/decorators/public.decorator";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { CompletePasswordResetDto } from "./dto/complete-password-reset.dto";
import { RecoverPasswordDto } from "./dto/recover-password.dto";
import { SwitchOrganizationDto } from "./dto/switch-organization.dto";
import { SetupOrganizationDto } from "./dto/setup-organization.dto";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { ActiveUser } from "@/common/decorators/active-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({
    short: { limit: 5, ttl: 60000 },
    long: { limit: 20, ttl: 3600000 },
  })
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Throttle({
    short: { limit: 3, ttl: 60000 },
    long: { limit: 10, ttl: 3600000 },
  })
  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Throttle({
    short: { limit: 3, ttl: 60000 },
    long: { limit: 10, ttl: 3600000 },
  })
  @Post("complete-password-reset")
  @HttpCode(HttpStatus.OK)
  async completePasswordReset(@Body() dto: CompletePasswordResetDto) {
    return this.authService.completePasswordReset(dto);
  }

  @Public()
  @Throttle({
    short: { limit: 3, ttl: 60000 },
    long: { limit: 10, ttl: 3600000 },
  })
  @Post("recover-password")
  @HttpCode(HttpStatus.OK)
  async recoverPassword(@Body() dto: RecoverPasswordDto) {
    return this.authService.recoverPassword(dto);
  }

  /**
   * Obtiene todas las organizaciones del usuario autenticado.
   * Super Admin: todas las orgs. Usuario estándar: solo las de Member.
   */
  @Get("organizations")
  @UseGuards(JwtAuthGuard)
  async getUserOrganizations(
    @ActiveUser() user: { id: number; isSuperAdmin?: boolean },
  ) {
    return this.authService.getUserOrganizations(
      user.id,
      user.isSuperAdmin ?? false,
    );
  }

  /**
   * Cambia la organización activa. Devuelve un nuevo token con el tenantId en el JWT.
   * El backend no confía en el ID enviado por el frontend: valida membresía y firma el nuevo token.
   */
  @Post("switch-organization")
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async switchOrganization(
    @ActiveUser() user: { id: number },
    @Body() dto: SwitchOrganizationDto,
  ) {
    return this.authService.switchOrganization(user.id, dto.organizationId);
  }

  /**
   * Alta de empresa para usuario autenticado sin organización (registro antiguo).
   */
  @Post("setup-organization")
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async setupOrganization(
    @ActiveUser() user: { id: number },
    @Body() dto: SetupOrganizationDto,
  ) {
    return this.authService.setupOrganization(user.id, dto);
  }
}
