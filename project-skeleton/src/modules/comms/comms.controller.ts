import {
  Controller,
  Post,
  Param,
  Req,
  UseGuards,
  BadRequestException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { CommsService } from './comms.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// endpoint ידני - שימושי כשמייל אוטומטי נכשל (למשל Gmail לא היה
// מחובר ברגע הסגירה) ומנהל רוצה לנסות לשלוח שוב אחרי שתיקן את זה.
//
// ה-taskId מגיע מה-URL ולכן הוא קלט של המשתמש; ה-tenantId מגיע רק
// מ-req.tenantId (שנקבע מה-subdomain) ולעולם לא מהבקשה. ParseUUIDPipe
// חוסם קלט שאינו UUID עוד לפני שהוא נוגע בשירות.
@UseGuards(JwtAuthGuard)
@Controller('comms')
export class CommsController {
  constructor(private readonly commsService: CommsService) {}

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
