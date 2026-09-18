import { IsCalendarDate } from '../../common/validation/calendar-date';

export class ProfitabilityQueryDto {
  @IsCalendarDate()
  from!: string;

  /** כולל. */
  @IsCalendarDate()
  to!: string;
}
