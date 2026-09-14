import { IsIn, IsString, Length } from 'class-validator';

// ============================================================
// ה-sessionSecret עבר קודם ב-**query string** בשתי נקודות קצה. שם הוא
// נוחת ב-access logs של הפרוקסי, בהיסטוריית הדפדפן וב-Referer של כל
// משאב חיצוני שהדף טוען. הוא עובר עכשיו בגוף הבקשה, או בכותרת
// X-Onboarding-Secret כשאין גוף (multipart/GET).
// ============================================================

export const SESSION_SECRET_HEADER = 'x-onboarding-secret';

/** 32 בתים אקראיים כ-hex = 64 תווים. אורך קבוע, נבדק לפני שנוגעים ב-DB. */
export class SessionSecretDto {
  @IsString()
  @Length(64, 64)
  sessionSecret!: string;
}

export class SendMessageDto extends SessionSecretDto {
  @IsString()
  @Length(1, 10_000)
  message!: string;
}

/** ל-finalize אין יותר `force` — הוא עקף את שער READY_TO_FINALIZE. */
export class FinalizeDto extends SessionSecretDto {}

export class UploadDocumentQueryDto {
  @IsIn(['QUOTE', 'MATERIAL_ORDER'])
  docType!: 'QUOTE' | 'MATERIAL_ORDER';
}
