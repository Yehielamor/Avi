import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';

import { CreatePriceListItemDto } from './dto/create-price-list-item.dto';
import { ListPriceListQueryDto } from './dto/list-price-list.query.dto';
import { UpdatePriceListItemDto } from './dto/update-price-list-item.dto';
import { PriceListService } from './price-list.service';

// מחירים הם מידע עסקי. טכנאי שטח לא צריך לראות מרווחים כדי לסגור
// משימה — הוא בוחר עבודה, והחשבונית מתמחרת אותה.
@Controller('price-list')
export class PriceListController {
  constructor(private readonly priceListService: PriceListService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  findAll(@Req() req: Request, @Query() query: ListPriceListQueryDto) {
    return this.priceListService.findAll(req.tenantId!, query);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  create(@Req() req: Request, @Body() body: CreatePriceListItemDto) {
    return this.priceListService.create(req.tenantId!, body, req.user?.id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Patch(':id')
  update(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePriceListItemDto,
  ) {
    return this.priceListService.update(req.tenantId!, id, body, req.user?.id);
  }
}
