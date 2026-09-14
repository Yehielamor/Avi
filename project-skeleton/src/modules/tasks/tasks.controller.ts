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
import type { Request } from 'express';

import { TasksService } from './tasks.service';
import { CloseTaskDto } from './dto/close-task.dto';
import { CreateManualTaskDto } from './dto/create-manual-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findAll(@Req() req: Request, @Query() query: ListTasksQueryDto) {
    return this.tasksService.findAll(req.tenantId!, query);
  }

  @Get(':id')
  findOne(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.tasksService.findOne(req.tenantId!, id);
  }

  @Post('manual')
  createManual(@Req() req: Request, @Body() body: CreateManualTaskDto) {
    return this.tasksService.createManual(req.tenantId!, body, req.user?.id);
  }

  @Post(':id/close')
  close(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: CloseTaskDto) {
    return this.tasksService.close(req.tenantId!, id, body.checklist, req.user?.id);
  }
}
