import { Matches } from 'class-validator';

export class ProfitabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  /** כולל. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;
}
