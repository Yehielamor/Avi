import { SetMetadata } from '@nestjs/common';

/**
 * מסמן route שמותר גם למשתמש שחייב להחליף סיסמה (`mustChangePassword`).
 *
 * onboarding יוצר חברי צוות עם סיסמה זמנית שאיש אינו יודע, והדגל הזה
 * מכריח החלפה בכניסה הראשונה. בלי החריגה הזו, המשתמש היה נחסם גם
 * מה-endpoint שאמור לשחרר אותו.
 */
export const ALLOW_PASSWORD_CHANGE_KEY = 'allowWhenPasswordChangeRequired';
export const AllowWhenPasswordChangeRequired = () => SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
