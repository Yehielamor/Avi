import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { AnyRole, Roles } from '../../common/decorators/roles.decorator';

import { TasksService, type TaskActor } from './tasks.service';
import { CloseTaskDto } from './dto/close-task.dto';
import { CreateManualTaskDto } from './dto/create-manual-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

/** טכנאי מוגבל למשימות שלו — נאכף בשירות, ב-WHERE (404 ולא 403). */
const actorOf = (req: Request): TaskActor => ({ id: req.user!.id, role: req.user!.role });

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @AnyRole()
  @Get()
  findAll(@Req() req: Request, @Query() query: ListTasksQueryDto) {
    return this.tasksService.findAll(req.tenantId!, query, actorOf(req));
  }

  @AnyRole()
  @Get(':id')
  findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.findOne(req.tenantId!, id, actorOf(req));
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('manual')
  createManual(@Req() req: Request, @Body() body: CreateManualTaskDto) {
    return this.tasksService.createManual(req.tenantId!, body, req.user?.id);
  }

  @AnyRole()
  @Post(':id/close')
  close(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseTaskDto) {
    return this.tasksService.close(req.tenantId!, id, body.checklist, actorOf(req));
  }
}
