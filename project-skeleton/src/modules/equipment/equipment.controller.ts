import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';

import { BookingRequestDto, CreateEquipmentDto, DueQueryDto, UpdateEquipmentDto } from './dto/equipment.dto';
import { EquipmentService } from './equipment.service';

@Controller()
export class EquipmentController {
  constructor(private readonly equipment: EquipmentService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('customers/:customerId/equipment')
  list(@Req() req: Request, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.equipment.listForCustomer(req.tenantId!, customerId);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('customers/:customerId/equipment')
  create(
    @Req() req: Request,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: CreateEquipmentDto,
  ) {
    return this.equipment.create(req.tenantId!, customerId, body, req.user!.id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch('equipment/:id')
  update(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEquipmentDto) {
    return this.equipment.update(req.tenantId!, id, body, req.user!.id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get('maintenance/due')
  due(@Req() req: Request, @Query() query: DueQueryDto) {
    return this.equipment.due(req.tenantId!, query.withinDays);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('equipment/:id/remind')
  remind(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.equipment.remind(req.tenantId!, id, req.user!.id);
  }
}

@Public()
@Controller('public/booking')
export class PublicBookingController {
  constructor(private readonly equipment: EquipmentService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  view(@Param('token') token: string) {
    return this.equipment.bookingView(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token')
  book(@Param('token') token: string, @Body() body: BookingRequestDto) {
    return this.equipment.book(token, body);
  }
}
