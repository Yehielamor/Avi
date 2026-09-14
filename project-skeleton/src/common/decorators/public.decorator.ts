import { SetMetadata } from '@nestjs/common';

/**
 * מסמן route כפתוח ללא אימות.
 *
 * הבחירה כאן היא ש-JwtAuthGuard הוא *גלובלי*, ונקודות פתוחות מסומנות
 * במפורש. ההפך — guard לכל controller — הוא איך שנשכחת guard הופכת
 * לנקודה חשופה בשקט. כאן שכחה מייצרת 401, לא דליפה.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
