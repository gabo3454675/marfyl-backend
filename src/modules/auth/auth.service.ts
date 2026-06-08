import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "@/common/prisma/prisma.service";
import * as bcrypt from "bcryptjs";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import {
  mapOrganizationForClient,
  organizationSelectForAuth,
} from "@/common/organization-mapper";
import {
  filterOrganizationsForLogin,
  isFoundingOrgSlug,
} from "@/common/founding-orgs";
import {
  assertOrganizationSlugAvailable,
  normalizeOrganizationSlug,
} from "@/common/org-slug";
import { SetupOrganizationDto } from "./dto/setup-organization.dto";
import { CompletePasswordResetDto } from "./dto/complete-password-reset.dto";
import { RecoverPasswordDto } from "./dto/recover-password.dto";
import { OrganizationProvisioningService } from "@/common/provisioning/organization-provisioning.service";
import { EmailService } from "@/modules/email/email.service";

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private provisioning: OrganizationProvisioningService,
    private emailService: EmailService,
  ) {}

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    if (user.isActive === false) {
      throw new UnauthorizedException(
        "Cuenta desactivada. Contacte al administrador.",
      );
    }

    // Password Reset Required: usuario provisionado con clave temporal (incluir email para prellenar en front)
    if (user.requiresPasswordChange === true) {
      throw new ForbiddenException({
        message: "RESET_REQUIRED",
        email: user.email,
      });
    }

    const isSuperAdmin = user.isSuperAdmin ?? false;

    // Para Super Admin: visibilidad de TODAS las organizaciones (Poder Global).
    // Para usuarios estándar: solo las de Member (Peso de Membresía).
    let organizations: ReturnType<typeof mapOrganizationForClient>[];

    if (isSuperAdmin) {
      const allOrgs = await this.prisma.organization.findMany({
        orderBy: { nombre: "asc" },
        select: organizationSelectForAuth,
      });
      organizations = allOrgs.map((o) =>
        mapOrganizationForClient(o, "SUPER_ADMIN"),
      );
    } else {
      const organizationMemberships = await this.prisma.member.findMany({
        where: {
          userId: user.id,
          status: "ACTIVE",
        },
        include: {
          organization: { select: organizationSelectForAuth },
        },
      });
      organizations = organizationMemberships.map((m) =>
        mapOrganizationForClient(m.organization, m.role),
      );
    }

    organizations = filterOrganizationsForLogin(organizations, {
      isPlatformSuperAdmin: isSuperAdmin,
    });

    // Obtener las empresas legacy a las que pertenece el usuario (CompanyMember)
    const companyMemberships = await this.prisma.companyMember.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            taxId: true,
            logoUrl: true,
            currency: true,
          },
        },
      },
    });

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isSuperAdmin,
      // Organizaciones (nuevo sistema): todas para Super Admin, solo memberships para estándar
      organizations,
      // Companies (legacy - mantener para compatibilidad)
      companies: companyMemberships.map((m) => ({
        id: m.company.id,
        name: m.company.name,
        taxId: m.company.taxId,
        logoUrl: m.company.logoUrl,
        currency: m.company.currency,
        role: m.role,
      })),
    };
  }

  /**
   * Completa el cambio de contraseña obligatorio (usuarios provisionados con clave temporal).
   * Verifica la contraseña actual y actualiza a la nueva.
   */
  async completePasswordReset(dto: CompletePasswordResetDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException("Credenciales inválidas");
    }

    if (!user.requiresPasswordChange) {
      throw new BadRequestException(
        "Este usuario no requiere cambio de contraseña",
      );
    }

    const isPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException("La contraseña actual no es correcta");
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        requiresPasswordChange: false,
      },
    });

    // Auditoría: registrar cambio de contraseña (en la primera org del usuario si tiene)
    const firstMembership = await this.prisma.member.findFirst({
      where: { userId: user.id, status: "ACTIVE" },
      select: { organizationId: true },
    });
    if (firstMembership) {
      await this.prisma.auditLog.create({
        data: {
          organizationId: firstMembership.organizationId,
          userId: user.id,
          action: "PASSWORD_CHANGE",
          entityType: "user",
          entityId: String(user.id),
          actorEmail: user.email,
          targetSummary: `Cambio de contraseña: ${user.email}`,
        },
      });
    }

    // Validar y obtener datos completos como en login
    const validatedUser = await this.validateUser(dto.email, dto.newPassword);

    const organizationId = validatedUser.organizations?.[0]?.id ?? null;
    const payload: {
      email: string;
      sub: number;
      isSuperAdmin: boolean;
      organizationId?: number;
    } = {
      email: validatedUser.email,
      sub: validatedUser.id,
      isSuperAdmin: validatedUser.isSuperAdmin ?? false,
    };
    if (organizationId != null) payload.organizationId = organizationId;

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: validatedUser.id,
        email: validatedUser.email,
        fullName: validatedUser.fullName,
        isSuperAdmin: validatedUser.isSuperAdmin,
        organizations: validatedUser.organizations,
        companies: validatedUser.companies,
      },
    };
  }

  /**
   * Recuperación de contraseña dentro del sistema (sin email externo).
   * Valida email + nombre completo para permitir restablecer la clave.
   */
  async recoverPassword(dto: RecoverPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException("No se pudo validar tu identidad");
    }

    if (user.isActive === false) {
      throw new UnauthorizedException(
        "Cuenta desactivada. Contacte al administrador.",
      );
    }

    const storedName = (user.fullName ?? "").trim().toLowerCase();
    const providedName = dto.fullName.trim().toLowerCase();
    if (!storedName || storedName !== providedName) {
      throw new UnauthorizedException("No se pudo validar tu identidad");
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.newPassword, saltRounds);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        requiresPasswordChange: false,
      },
    });

    return {
      message: "Clave actualizada correctamente. Ya puedes iniciar sesión.",
    };
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    // Tenant en JWT: organización activa (primera de la lista). El backend no confía en el frontend.
    const organizationId = user.organizations?.[0]?.id ?? null;
    const payload: {
      email: string;
      sub: number;
      isSuperAdmin: boolean;
      organizationId?: number;
    } = {
      email: user.email,
      sub: user.id,
      isSuperAdmin: user.isSuperAdmin ?? false,
    };
    if (organizationId != null) payload.organizationId = organizationId;

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isSuperAdmin: user.isSuperAdmin,
        organizations: user.organizations,
        companies: user.companies,
      },
    };
  }

  /**
   * Cambia la organización activa y devuelve un nuevo JWT con ese tenantId.
   * Valida que el usuario sea miembro de la organización (o SUPER_ADMIN).
   */
  async switchOrganization(userId: number, organizationId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isSuperAdmin: true },
    });
    if (!user) throw new UnauthorizedException("Usuario no encontrado");

    const membership = await this.prisma.member.findFirst({
      where: {
        userId,
        organizationId,
        status: "ACTIVE",
      },
    });
    const isSuperAdmin = user.isSuperAdmin ?? false;
    if (!membership && !isSuperAdmin) {
      throw new ForbiddenException("No tienes acceso a esta organización");
    }

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) throw new BadRequestException("Organización no encontrada");

    const payload = {
      email: user.email,
      sub: user.id,
      isSuperAdmin,
      organizationId,
    };
    return {
      access_token: this.jwtService.sign(payload),
      organizationId,
    };
  }

  private async createOrganizationForNewCustomer(
    userId: number,
    organizationName: string,
    organizationSlug: string,
  ) {
    const slug = normalizeOrganizationSlug(organizationSlug);
    try {
      assertOrganizationSlugAvailable(slug);
    } catch {
      throw new BadRequestException(
        "El identificador de empresa no es válido o está reservado",
      );
    }
    if (isFoundingOrgSlug(slug)) {
      throw new ConflictException(
        "Este identificador de empresa está reservado",
      );
    }

    const existingOrg = await this.prisma.organization.findUnique({
      where: { slug },
    });
    if (existingOrg) {
      throw new ConflictException(
        "Ya existe una empresa con ese identificador",
      );
    }

    const existingMembership = await this.prisma.member.findFirst({
      where: { userId, status: "ACTIVE" },
    });
    if (existingMembership) {
      throw new ConflictException(
        "Este usuario ya tiene una empresa registrada",
      );
    }

    const nombre = organizationName.trim();
    if (!nombre) {
      throw new BadRequestException("El nombre de la empresa es obligatorio");
    }

    return this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          nombre,
          slug,
          plan: "BASIC",
          billingExempt: false,
          concertModuleEnabled: false,
        },
        select: organizationSelectForAuth,
      });

      await tx.member.create({
        data: {
          userId,
          organizationId: organization.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });

      await this.provisioning.provisionInTransaction(tx, {
        organizationId: organization.id,
        organizationName: nombre,
      });

      return organization;
    });
  }

  private sendWelcomeEmailAsync(
    email: string,
    fullName: string,
    organizationName: string,
  ): void {
    setImmediate(() => {
      this.emailService
        .sendWelcomeEmail(email, fullName, organizationName)
        .catch(() => undefined);
    });
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException("El email ya está registrado");
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(registerDto.password, saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email: registerDto.email,
        passwordHash,
        fullName: registerDto.fullName,
        isSuperAdmin: false,
      },
    });

    await this.createOrganizationForNewCustomer(
      user.id,
      registerDto.organizationName,
      registerDto.organizationSlug,
    );

    this.sendWelcomeEmailAsync(
      registerDto.email,
      registerDto.fullName,
      registerDto.organizationName.trim(),
    );

    const validatedUser = await this.validateUser(
      registerDto.email,
      registerDto.password,
    );
    const organizationId = validatedUser.organizations?.[0]?.id ?? null;
    const payload: {
      email: string;
      sub: number;
      isSuperAdmin: boolean;
      organizationId?: number;
    } = {
      email: validatedUser.email,
      sub: validatedUser.id,
      isSuperAdmin: false,
    };
    if (organizationId != null) payload.organizationId = organizationId;

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: validatedUser.id,
        email: validatedUser.email,
        fullName: validatedUser.fullName,
        isSuperAdmin: false,
        organizations: validatedUser.organizations,
        companies: validatedUser.companies,
      },
    };
  }

  /**
   * Usuario ya registrado sin empresa: completa alta de negocio (misma lógica que /register).
   */
  async setupOrganization(userId: number, dto: SetupOrganizationDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, isSuperAdmin: true },
    });
    if (!user) throw new UnauthorizedException("Usuario no encontrado");
    if (user.isSuperAdmin) {
      throw new ForbiddenException(
        "El administrador de plataforma crea empresas desde Configuración",
      );
    }

    await this.createOrganizationForNewCustomer(
      userId,
      dto.organizationName,
      dto.organizationSlug,
    );

    this.sendWelcomeEmailAsync(
      user.email,
      user.fullName ?? user.email,
      dto.organizationName.trim(),
    );

    const orgs = await this.getUserOrganizations(userId, false);
    const organizationId = orgs[0]?.id;
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isSuperAdmin: true },
    });
    const payload = {
      email: dbUser!.email,
      sub: userId,
      isSuperAdmin: dbUser!.isSuperAdmin ?? false,
      organizationId,
    };

    return {
      access_token: this.jwtService.sign(payload),
      organizationId,
      organizations: orgs,
    };
  }

  /**
   * Obtiene todas las organizaciones del usuario.
   * - Super Admin (isSuperAdmin): devuelve TODAS las organizaciones de la BD.
   * - Usuario estándar: solo las de la tabla Member.
   */
  async getUserOrganizations(userId: number, isSuperAdmin = false) {
    if (isSuperAdmin) {
      const allOrgs = await this.prisma.organization.findMany({
        orderBy: { nombre: "asc" },
        select: organizationSelectForAuth,
      });
      return allOrgs.map((o) => ({
        ...mapOrganizationForClient(o, "SUPER_ADMIN"),
        nombre: o.nombre,
        status: "ACTIVE",
        joinedAt: new Date(),
      }));
    }

    const memberships = await this.prisma.member.findMany({
      where: {
        userId,
        status: "ACTIVE",
      },
      include: {
        organization: { select: organizationSelectForAuth },
      },
      orderBy: {
        joinedAt: "desc",
      },
    });

    const mapped = memberships.map((m) => ({
      ...mapOrganizationForClient(m.organization, m.role),
      nombre: m.organization.nombre,
      status: m.status,
      joinedAt: m.joinedAt,
    }));

    return filterOrganizationsForLogin(mapped, {
      isPlatformSuperAdmin: isSuperAdmin,
    });
  }
}
