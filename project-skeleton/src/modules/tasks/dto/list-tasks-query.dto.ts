import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { TaskStatus } from '@prisma/client';

/**
 * `?status=closed` היה מגיע ל-Prisma כ-`status as any` ומתפוצץ ב-500.
 * `@IsEnum` הופך את זה ל-400 עם רשימת הערכים החוקיים.
 */
export class ListTasksQueryDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  // `findAll` היה ללא גבול. עמוד ברירת מחדל קטן הוא ההבדל בין
  // דף רשימה לבין טעינת 100k שורות עם include לזיכרון.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  /** מזהה השורה האחרונה בעמוד הקודם (keyset pagination). */
  @IsOptional()
  @IsUUID()
  cursor?: string;

  /**
   * רק המשימות המשויכות למשתמש המחובר.
   *
   * boolean ולא `assignedToUserId`: אילו הלקוח היה שולח מזהה, כל
   * טכנאי היה יכול לבקש את התור של עמיתו. כאן הזהות נלקחת מהטוקן
   * ואינה ניתנת להצהרה.
   *
   * ה-transform נדרש כי query string הוא תמיד מחרוזת — בלעדיו
   * `?assignedToMe=false` היה מתפרש כ-true.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  assignedToMe?: boolean;

  /**
   * מיון לפי עדיפות ואז תאריך, במקום תאריך בלבד.
   *
   * ה-PWA של השטח מיין בצד הלקוח, ולכן המיון היה נכון רק בתוך העמוד
   * שנשלף — משימה דחופה בעמוד השני הופיעה אחרי משימות רגילות.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  urgentFirst?: boolean;
}
