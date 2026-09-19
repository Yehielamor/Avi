import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Public } from '../../../common/decorators/public.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { InboundEmailDto } from '../dto/inbound-email.dto';

import { InboundEmailService } from './inbound-email.service';
import { SIGNATURE_HEADER, verifyInbound } from './inbound-signature';

/**
 * הכניסה מה-Email Worker. ציבורי מבחינת התחברות — ההרשאה היא החתימה.
 *
 * SkipThrottle: כל הבקשות מגיעות מכתובות של Cloudflare, ו-throttle לפי IP
 * היה חוסם את כל העסקים יחד בגלל אחד עמוס. בקשה לא חתומה נדחית לפני כל
 * עבודה, והעלות של ספאם חתום (דרך כתובת שדלפה) מוגבלת בתקרת ה-LLM של הטננט.
 */
@Public()
@SkipThrottle()
@Controller('intake/inbound')
export class InboundEmailWebhookController {
  constructor(private readonly inbound: InboundEmailService) {}

  @Post()
  @HttpCode(200)
  receive(@Req() req: Request & { rawBody?: Buffer }, @Body() body: InboundEmailDto) {
    if (this.inbound.enabled) {
      const check = verifyInbound(req.header(SIGNATURE_HEADER), req.rawBody, this.inbound.secret);
      if (!check.ok) throw new UnauthorizedException('Invalid signature');
    }
    return this.inbound.receive(body);
  }
}

@Controller('intake/mailbox')
export class InboundMailboxController {
  constructor(private readonly inbound: InboundEmailService) {}

  /** הכתובת להעברה, קוד האימות של Gmail אם הגיע, ומתי הגיע מייל אחרון. */
  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Get()
  get(@Req() req: Request) {
    return this.inbound.mailbox(req.tenantId!);
  }

  @Roles(UserRole.OWNER)
  @Post('rotate')
  rotate(@Req() req: Request) {
    return this.inbound.rotate(req.tenantId!, req.user!.id);
  }
}
