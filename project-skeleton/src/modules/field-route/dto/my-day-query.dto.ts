import { IsOptional } from 'class-validator';

import { IsCalendarDate } from '../../../common/validation/calendar-date';

export class MyDayQueryDto {
  /** יום לפי שעון ישראל. ברירת מחדל: היום. */
  @IsOptional()
  @IsCalendarDate()
  date?: string;
}
