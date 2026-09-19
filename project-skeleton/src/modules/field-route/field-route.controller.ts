import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AnyRole } from '../../common/decorators/roles.decorator';

import { MyDayQueryDto } from './dto/my-day-query.dto';
import { SiteLocationDto } from './dto/site-location.dto';
import { FieldRouteService } from './field-route.service';

@Controller()
export class FieldRouteController {
  constructor(private readonly route: FieldRouteService) {}

  /** המשימות של המשתמש המחובר ליום, בסדר נסיעה. */
  @AnyRole()
  @Get('field/my-day')
  myDay(@Req() req: Request, @Query() query: MyDayQueryDto) {
    return this.route.myDay(req.tenantId!, req.user!.id, query.date);
  }

  // טכנאי — רק למשימה שלו (נאכף ב-WHERE בשירות).
  @AnyRole()
  @HttpCode(200)
  @Post('tasks/:id/site-location')
  siteLocation(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: SiteLocationDto) {
    return this.route.learnSiteLocation(req.tenantId!, id, body, { id: req.user!.id, role: req.user!.role });
  }
}
