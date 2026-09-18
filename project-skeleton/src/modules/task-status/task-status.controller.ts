import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { AnyRole, Roles } from '../../common/decorators/roles.decorator';

import { RescheduleRequestDto } from './dto/reschedule-request.dto';
import { ScheduleTaskDto } from './dto/schedule-task.dto';
import { TaskStatusService } from './task-status.service';

@Controller('tasks')
export class TaskStatusController {
  constructor(private readonly status: TaskStatusService) {}

  // כל תפקיד: טכנאי משתף רק משימה שלו — נאכף בשירות, ב-WHERE.
  @AnyRole()
  @Post(':id/share-link')
  share(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.status.share(req.tenantId!, id, { id: req.user!.id, role: req.user!.role });
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch(':id/schedule')
  schedule(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: ScheduleTaskDto) {
    return this.status.schedule(req.tenantId!, id, body, req.user!.id);
  }

  @AnyRole()
  @Post(':id/on-the-way')
  onTheWay(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.status.onTheWay(req.tenantId!, id, { id: req.user!.id, role: req.user!.role });
  }
}

/**
 * הצד של הלקוח. בלי התחברות — הטוקן הוא ההרשאה. throttle הדוק: מי שמנסה
 * לנחש טוקנים נתקע הרבה לפני שהוא מתקרב לסיכוי.
 */
@Public()
@Controller('public/status')
export class PublicTaskStatusController {
  constructor(private readonly status: TaskStatusService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  view(@Param('token') token: string) {
    return this.status.view(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/confirm')
  confirm(@Param('token') token: string) {
    return this.status.confirm(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/reschedule')
  reschedule(@Param('token') token: string, @Body() body: RescheduleRequestDto) {
    return this.status.requestReschedule(token, body.note);
  }
}
