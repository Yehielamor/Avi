import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
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
}
