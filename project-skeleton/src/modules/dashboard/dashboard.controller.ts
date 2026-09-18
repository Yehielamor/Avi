import { Controller, Get, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { BriefService } from './brief.service';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly briefs: BriefService,
  ) {}

  /**
   * מוגבל לניהול: המספרים כוללים הכנסות ומלאי, שאינם עניינו של
   * טכנאי שטח. ה-PWA שלו מציג את המשימות שלו בלבד.
   */
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('stats')
  stats(@Req() req: Request) {
    return this.dashboard.getStats(req.tenantId!);
  }

  /** תדריך הבוקר. גם רושם יום פעילות — זו מדידת השימור. */
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('brief')
  brief(@Req() req: Request) {
    return this.briefs.brief(req.tenantId!, req.user!.id);
  }

  /** רשימת "השבוע הראשון". */
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('activation')
  activation(@Req() req: Request) {
    return this.briefs.activation(req.tenantId!);
  }
}
