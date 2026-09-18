import { ValidationPipe, type PipeTransform } from '@nestjs/common';

import { RejectNulPipe } from './reject-nul.pipe';

/**
 * ה-pipes הגלובליים, במקום אחד — main.ts ובדיקות ה-HTTP משתמשים באותה
 * רשימה, כך שבדיקה לא עוברת מול הגדרה שונה מזו שרצה בפרודקשן.
 *
 * whitelist + forbidNonWhitelisted הם מה שחוסם את
 * `POST /auth/register {"role":"OWNER"}` — שדה שאינו ב-DTO נדחה
 * ב-400 במקום להגיע ל-prisma.create. ראו docs/10-audit-findings.md#I2.
 */
export function buildGlobalPipes(isProd: boolean): PipeTransform[] {
  return [
    new RejectNulPipe(),
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // בפרודקשן לא מחזירים את הערך שנכשל — הוא עלול להכיל סוד.
      disableErrorMessages: false,
      validationError: { target: false, value: !isProd },
    }),
  ];
}
