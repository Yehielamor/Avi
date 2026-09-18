import { Controller, Get, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';

import { ProfitabilityQueryDto } from './profitability-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // רווחיות היא מידע עסקי רגיש — לא לטכנאים.
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('profitability')
  profitability(@Req() req: Request, @Query() q: ProfitabilityQueryDto) {
    return this.reports.profitability(req.tenantId!, q.from, q.to);
  }
}
