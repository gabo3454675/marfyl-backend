import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import {
  PayrollPayType,
  PayrollProfileStatus,
  PayrollRunStatus,
} from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import { getCompanyIdFromOrganization } from "@/common/helpers/organization.helper";
import {
  PAYROLL_CATEGORY_NAME,
  calculateNetAmount,
  defaultProfileForRole,
  mapPayTypeToFrontend,
  mapProfileStatus,
  mapPayTypeFromFrontend,
  num,
  roleToLabel,
  type PayrollProfileWithMember,
} from "./payroll.helpers";
import type { AdjustPayrollProfileDto } from "./dto/update-payroll-profile.dto";
import type { UpdatePayrollProfileDto } from "./dto/update-payroll-profile.dto";

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(organizationId: number) {
    const members = await this.prisma.member.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: {
        user: {
          select: { id: true, email: true, fullName: true, avatarUrl: true },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    const existing = await this.prisma.payrollProfile.findMany({
      where: { organizationId },
      include: {
        member: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    const byMemberId = new Map(existing.map((p) => [p.memberId, p]));

    const toCreate: {
      organizationId: number;
      memberId: number;
      payType: PayrollPayType;
      baseSalary: number;
      commissionPct?: number;
      hoursWorked?: number;
    }[] = [];

    for (const member of members) {
      if (!byMemberId.has(member.id)) {
        const defaults = defaultProfileForRole(member.role);
        toCreate.push({
          organizationId,
          memberId: member.id,
          payType: defaults.payType,
          baseSalary: defaults.baseSalary,
          commissionPct: defaults.commissionPct,
          hoursWorked: defaults.payType === "HOURLY" ? 160 : undefined,
        });
      }
    }

    if (toCreate.length > 0) {
      await this.prisma.payrollProfile.createMany({ data: toCreate });
      const refreshed = await this.prisma.payrollProfile.findMany({
        where: { organizationId },
        include: {
          member: {
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  fullName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      });
      return refreshed
        .filter((p) => members.some((m) => m.id === p.memberId))
        .map((p) => this.toEmployeeDto(p as PayrollProfileWithMember));
    }

    return members
      .map((m) => byMemberId.get(m.id))
      .filter(Boolean)
      .map((p) => this.toEmployeeDto(p as PayrollProfileWithMember));
  }

  async adjustProfile(
    organizationId: number,
    memberId: number,
    dto: AdjustPayrollProfileDto,
  ) {
    const profile = await this.findProfileOrThrow(organizationId, memberId);
    const bonus = dto.bonusAmount ?? 0;
    const deduction = dto.deductionAmount ?? 0;
    if (bonus <= 0 && deduction <= 0) {
      throw new BadRequestException("Indica un monto de bonificación o deducción.");
    }

    const updated = await this.prisma.payrollProfile.update({
      where: { id: profile.id },
      data: {
        bonuses: num(profile.bonuses) + bonus,
        deductions: num(profile.deductions) + deduction,
        status: PayrollProfileStatus.REVIEW,
      },
      include: {
        member: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return this.toEmployeeDto(updated as PayrollProfileWithMember);
  }

  async updateProfile(
    organizationId: number,
    memberId: number,
    dto: UpdatePayrollProfileDto,
  ) {
    await this.findProfileOrThrow(organizationId, memberId);
    const data: Record<string, unknown> = {};
    if (dto.type) data.payType = mapPayTypeFromFrontend(dto.type);
    if (dto.baseSalary != null) data.baseSalary = dto.baseSalary;
    if (dto.commission != null) data.commissionPct = dto.commission;
    if (dto.hoursWorked != null) data.hoursWorked = dto.hoursWorked;

    const updated = await this.prisma.payrollProfile.update({
      where: {
        organizationId_memberId: { organizationId, memberId },
      },
      data,
      include: {
        member: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return this.toEmployeeDto(updated as PayrollProfileWithMember);
  }

  async processPayroll(organizationId: number, userId: number) {
    const profiles = await this.prisma.payrollProfile.findMany({
      where: { organizationId },
      include: {
        member: {
          include: {
            user: {
              select: { fullName: true, email: true },
            },
          },
        },
      },
    });

    const payable = profiles
      .map((p) => ({ profile: p, amount: calculateNetAmount(p) }))
      .filter((x) => x.amount > 0);

    if (payable.length === 0) {
      throw new BadRequestException("No hay pagos con monto mayor a cero.");
    }

    const category = await this.prisma.expenseCategory.findFirst({
      where: {
        organizationId,
        name: { equals: PAYROLL_CATEGORY_NAME, mode: "insensitive" },
      },
    });
    if (!category) {
      throw new NotFoundException(
        `Categoría de gasto "${PAYROLL_CATEGORY_NAME}" no encontrada.`,
      );
    }

    const companyId = await getCompanyIdFromOrganization(
      this.prisma,
      organizationId,
    );
    const periodLabel = new Date().toLocaleDateString("es-VE", {
      month: "long",
      year: "numeric",
    });
    const today = new Date();

    return this.prisma.$transaction(async (tx) => {
      const errors: string[] = [];
      let totalAmount = 0;
      let createdCount = 0;

      const run = await tx.payrollRun.create({
        data: {
          organizationId,
          processedById: userId,
          periodLabel,
          status: PayrollRunStatus.COMPLETED,
          totalAmount: 0,
          employeeCount: 0,
        },
      });

      for (const { profile, amount } of payable) {
        const name =
          profile.member.user.fullName ?? profile.member.user.email ?? "Empleado";
        const description = `Nómina - ${name} - ${periodLabel}`;

        try {
          const expense = await tx.expense.create({
            data: {
              companyId,
              organizationId,
              date: today,
              amount,
              description,
              status: "PAID",
              categoryId: category.id,
            },
          });

          await tx.expensePayment.create({
            data: {
              organizationId,
              expenseId: expense.id,
              amount,
              notes: `Pago nómina ${periodLabel}`,
            },
          });

          let base = num(profile.baseSalary);
          if (profile.payType === "HOURLY" && profile.hoursWorked != null) {
            base = base * num(profile.hoursWorked);
          } else if (profile.payType === "COMMISSION") {
            base = base + base * (num(profile.commissionPct) / 100);
          }

          await tx.payrollLine.create({
            data: {
              organizationId,
              payrollRunId: run.id,
              payrollProfileId: profile.id,
              memberId: profile.memberId,
              employeeName: name,
              amount,
              baseAmount: base,
              bonuses: profile.bonuses,
              deductions: profile.deductions,
              expenseId: expense.id,
            },
          });

          await tx.payrollProfile.update({
            where: { id: profile.id },
            data: {
              status: PayrollProfileStatus.PAID,
              lastProcessedAt: today,
            },
          });

          totalAmount += amount;
          createdCount += 1;
        } catch {
          errors.push(name);
        }
      }

      const status =
        errors.length === 0
          ? PayrollRunStatus.COMPLETED
          : createdCount > 0
            ? PayrollRunStatus.PARTIAL
            : PayrollRunStatus.FAILED;

      const finalRun = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          totalAmount,
          employeeCount: createdCount,
          status,
        },
        include: {
          lines: true,
        },
      });

      return {
        run: this.toRunDto(finalRun),
        created: createdCount,
        errors,
      };
    });
  }

  async listRuns(organizationId: number, limit = 20) {
    const runs = await this.prisma.payrollRun.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 50),
      include: {
        processedBy: { select: { fullName: true, email: true } },
        lines: {
          select: {
            id: true,
            employeeName: true,
            amount: true,
            createdAt: true,
          },
        },
      },
    });
    return runs.map((r) => this.toRunDto(r));
  }

  async getRun(organizationId: number, runId: number) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { id: runId, organizationId },
      include: {
        processedBy: { select: { fullName: true, email: true } },
        lines: true,
      },
    });
    if (!run) throw new NotFoundException("Lote de nómina no encontrado.");
    return this.toRunDto(run);
  }

  private async findProfileOrThrow(organizationId: number, memberId: number) {
    const profile = await this.prisma.payrollProfile.findFirst({
      where: { organizationId, memberId },
    });
    if (!profile) {
      throw new NotFoundException("Perfil de nómina no encontrado.");
    }
    return profile;
  }

  private toEmployeeDto(profile: PayrollProfileWithMember) {
    const user = profile.member.user;
    return {
      id: profile.memberId,
      memberId: profile.memberId,
      profileId: profile.id,
      name: user.fullName ?? user.email,
      avatar: user.avatarUrl,
      role: roleToLabel(profile.member.role),
      type: mapPayTypeToFrontend(profile.payType),
      baseSalary: num(profile.baseSalary),
      commission: profile.commissionPct != null ? num(profile.commissionPct) : undefined,
      hoursWorked: profile.hoursWorked != null ? num(profile.hoursWorked) : undefined,
      bonuses: num(profile.bonuses),
      deductions: num(profile.deductions),
      status: mapProfileStatus(profile.status),
      netAmount: calculateNetAmount(profile),
      lastProcessedAt: profile.lastProcessedAt,
    };
  }

  private toRunDto(
    run: {
      id: number;
      periodLabel: string;
      totalAmount: unknown;
      employeeCount: number;
      status: PayrollRunStatus;
      createdAt: Date;
      processedBy?: { fullName: string | null; email: string } | null;
      lines?: {
        id: number;
        employeeName: string;
        amount: unknown;
        createdAt: Date;
      }[];
    },
  ) {
    return {
      id: run.id,
      periodLabel: run.periodLabel,
      totalAmount: num(run.totalAmount),
      employeeCount: run.employeeCount,
      status: run.status.toLowerCase(),
      createdAt: run.createdAt,
      processedBy:
        run.processedBy?.fullName ?? run.processedBy?.email ?? null,
      lines: (run.lines ?? []).map((l) => ({
        id: l.id,
        employeeName: l.employeeName,
        amount: num(l.amount),
        date: l.createdAt,
      })),
    };
  }
}
