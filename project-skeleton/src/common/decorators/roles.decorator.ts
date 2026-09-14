import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * מגביל route לתפקידים מסוימים.
 *
 * מוטפס מול ה-enum של Prisma ולא מול מחרוזות: `@Roles('owner')` לא
 * יתקמפל, ולכן אי אפשר להגביל route לתפקיד שאינו קיים ובכך לנעול
 * אותו בשקט לכולם.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * מסמן route כפתוח לכל משתמש *מאומת*, ללא קשר לתפקיד.
 *
 * הסימון הזה נראה מיותר — ואפשר היה פשוט לא לכתוב `@Roles`. הוא קיים
 * בדיוק כדי שזה לא יהיה אפשרי: `RolesGuard` דוחה route ללא סימון
 * כלל. ההבחנה בין "פתוח לכולם במכוון" לבין "מישהו שכח" חייבת להיות
 * גלויה בקוד, לא משתמעת מהיעדר שורה.
 *
 * זה אותו עיקרון כמו `@Public()`: שכחה מייצרת 403, לא חור.
 */
export const ANY_ROLE_KEY = 'anyRole';
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true);
