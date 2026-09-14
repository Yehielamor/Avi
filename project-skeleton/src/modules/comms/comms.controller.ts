import {
  Controller,
  Post,
  Param,
  Req,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { CommsService } from './comms.service';
import { Roles } from '../../common/decorators/roles.decorator';

// endpoint ידני - שימושי כשמייל אוטומטי נכשל (למשל Gmail לא היה
// מחובר ברגע הסגירה) ומנהל רוצה לנסות לשלוח שוב אחרי שתיקן את זה.
//
// ה-taskId מגיע מה-URL ולכן הוא קלט של המשתמש; ה-tenantId מגיע רק
// מ-req.tenantId (שנקבע מה-subdomain) ולעולם לא מהבקשה. ParseUUIDPipe
// חוסם קלט שאינו UUID עוד לפני שהוא נוגע בשירות.
@Controller('comms')
export class CommsController {
  constructor(private readonly commsService: CommsService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('tasks/:id/resend-closed-email')
  async resend(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.commsService.resendClosedEmail(req.tenantId!, id);
    if (!result.sent) {
      throw new BadRequestException(result.reason ?? 'Could not send email');
    }
    return result;
  }
}
