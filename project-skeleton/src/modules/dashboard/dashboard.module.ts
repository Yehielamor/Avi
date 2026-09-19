import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { BriefService } from './brief.service';
import { DashboardService } from './dashboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, BriefService],
})
export class DashboardModule {}
