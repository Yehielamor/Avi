import { IsDateString, IsOptional, Matches } from 'class-validator';

/**
 * מועד מלא עם שעה ואזור זמן מפורש (`Z` או `+03:00`).
 *
 * `IsDateString` לבד קיבל גם `2026-10-01`, ש-`new Date` מפרש כחצות UTC —
 * 03:00 בלילה בישראל — בלי שאיש ביקש (QA 18.09, F11). הממשק שולח תמיד
 * `toISOString()`.
 */
const DATE_TIME_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const message = '$property must be a full date and time with a time zone, e.g. 2026-10-01T08:00:00.000Z';

export class ScheduleTaskDto {
  @IsDateString({ strict: true })
  @Matches(DATE_TIME_WITH_ZONE, { message })
  scheduledStart!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DATE_TIME_WITH_ZONE, { message })
  scheduledEnd?: string;
}
