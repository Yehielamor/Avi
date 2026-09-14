import { Controller, Get, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /**
   * מוגבל לניהול: המספרים כוללים הכנסות ומלאי, שאינם עניינו של
   * טכנאי שטח. ה-PWA שלו מציג את המשימות שלו בלבד.
   */
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('stats')
  stats(@Req() req: Request) {
    return this.dashboard.getStats(req.tenantId!);
  }
}
