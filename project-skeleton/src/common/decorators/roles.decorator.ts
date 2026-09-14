import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

/**
 * מסמן אילו תפקידים רשאים להגיע ל-route.
 *
 * `UserRole` היה enum דקורטיבי: הוא נחתם ל-JWT ומעולם לא נקרא, כך
 * שטכנאי `FIELD` יכול היה לנתק את חשבון Google של העסק, לקרוא את כל
 * הלקוחות ולהפיק חשבוניות. ראו docs/20-backend-conventions.md#3.
 *
 * הטיפוס הוא `UserRole` מ-Prisma ולא מחרוזת — הוספת תפקיד לסכימה
 * בלי לעדכן את הדקורטורים נכשלת בקומפילציה, לא בזמן ריצה.
 */
export const ROLES_KEY = 'roles';

export const Roles = (...roles: [UserRole, ...UserRole[]]) => SetMetadata(ROLES_KEY, roles);
