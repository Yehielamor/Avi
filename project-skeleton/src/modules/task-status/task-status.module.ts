import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { PublicTaskStatusController, TaskStatusController } from './task-status.controller';
import { TaskStatusService } from './task-status.service';

@Module({
  imports: [AuthModule],
  controllers: [TaskStatusController, PublicTaskStatusController],
  providers: [TaskStatusService],
})
export class TaskStatusModule {}
