import { Controller, Post, Req } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { Roles } from '../../common/decorators/roles.decorator';
import { EmailIntakeService } from './email-intake.service';

// ============================================================
// הסנכרון היזום עבר לכאן מ-`integrations.controller.ts` יחד עם
// התזמור שמאחוריו. ב-production זה מה שה-cron קורא (כל 2-5 דקות);
// הוא חשוף גם ידנית לצורך בדיקה.
//
// שים לב: זו עדיין עבודה ארוכה ב-HTTP handler. לפי
// docs/20-backend-conventions.md §7 היא צריכה לרוץ בעובד דרך ה-outbox.
// המעבר הזה חורג מגבולות המודול הזה (הוא דורש את תשתית העובד),
// ולכן התקרה הקשיחה ב-GmailConnector היא מה שמחזיק את זמן הבקשה
// בינתיים.
// ============================================================
@Controller('intake')
export class IntakeController {
  constructor(private readonly emailIntake: EmailIntakeService) {}

  @Roles(UserRole.OWNER, UserRole.MANAGER)
  @Post('gmail/sync')
  syncGmail(@Req() req: Request) {
    return this.emailIntake.syncGmail(req.tenantId!);
  }
}
