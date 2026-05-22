import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { OrganizationGuard } from '@/common/guards/organization.guard';
import { ActiveOrganization } from '@/common/decorators/active-organization.decorator';
import { ActiveUser } from '@/common/decorators/active-user.decorator';

@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /**
   * Crear tarea y asignar a un usuario.
   * Requiere header x-tenant-id (organización). Valida que creador y asignado sean de la misma org.
   */
  @Post()
  @UseGuards(OrganizationGuard)
  create(
    @Body() createTaskDto: CreateTaskDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.tasksService.create(
      createTaskDto,
      organizationId,
      user.id,
    );
  }

  /**
   * Obtener tareas pendientes (PENDING / IN_PROGRESS) del usuario en la organización activa.
   * Requiere x-tenant-id. Query: category (ej. COBRANZA) para filtrar por categoría.
   */
  @Get('my-pending')
  @UseGuards(OrganizationGuard)
  getMyPending(
    @ActiveUser() user: { id: number },
    @ActiveOrganization() organizationId: number,
    @Query('category') category?: string,
  ) {
    return this.tasksService.getMyPending(user.id, organizationId, category);
  }

  /**
   * Contar tareas no leídas asignadas al usuario en la organización activa (para badge).
   * Requiere x-tenant-id.
   */
  @Get('my-unread-count')
  @UseGuards(OrganizationGuard)
  getMyUnreadCount(
    @ActiveUser() user: { id: number },
    @ActiveOrganization() organizationId: number,
  ) {
    return this.tasksService.getMyUnreadCount(user.id, organizationId);
  }

  /**
   * Tareas creadas por el usuario en la organización activa.
   * Requiere x-tenant-id.
   */
  @Get('created-by-me')
  @UseGuards(OrganizationGuard)
  getCreatedByMe(
    @ActiveUser() user: { id: number },
    @ActiveOrganization() organizationId: number,
  ) {
    return this.tasksService.getCreatedByMe(user.id, organizationId);
  }

  /**
   * Marcar tarea como leída (solo asignado o admin). No requiere x-tenant-id.
   */
  @Patch(':id/read')
  markAsRead(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.tasksService.markAsRead(id, user.id);
  }

  /**
   * Actualizar estado de una tarea (ej. marcar como DONE).
   * Requiere organización para verificar permisos.
   */
  @Patch(':id/status')
  @UseGuards(OrganizationGuard)
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaskStatusDto,
    @ActiveOrganization() organizationId: number,
    @ActiveUser() user: { id: number },
  ) {
    return this.tasksService.updateStatus(
      id,
      dto.status,
      user.id,
      organizationId,
    );
  }
}
