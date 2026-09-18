import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PUBLIC_ACTION_THROTTLE, PUBLIC_VIEW_THROTTLE } from '../../common/throttle';

import { CreateQuoteDto } from './dto/create-quote.dto';
import { QuotesService } from './quotes.service';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  list(@Req() req: Request) {
    return this.quotes.list(req.tenantId!);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get(':id')
  get(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(req.tenantId!, id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post()
  create(@Req() req: Request, @Body() body: CreateQuoteDto) {
    return this.quotes.create(req.tenantId!, body, req.user!.id);
  }

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post(':id/send')
  send(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.send(req.tenantId!, id, req.user!.id);
  }
}

@Public()
@Controller('public/quote')
export class PublicQuoteController {
  constructor(private readonly quotes: QuotesService) {}

  @Throttle(PUBLIC_VIEW_THROTTLE)
  @Get(':token')
  view(@Param('token') token: string) {
    return this.quotes.publicView(token);
  }

  @Throttle(PUBLIC_ACTION_THROTTLE)
  @Post(':token/approve')
  approve(@Param('token') token: string) {
    return this.quotes.approve(token);
  }

  @Throttle(PUBLIC_ACTION_THROTTLE)
  @Post(':token/decline')
  decline(@Param('token') token: string) {
    return this.quotes.decline(token);
  }
}
