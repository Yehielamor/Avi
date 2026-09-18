import { IsDateString, IsOptional } from 'class-validator';

export class ScheduleTaskDto {
  @IsDateString({ strict: true })
  scheduledStart!: string;

  @IsOptional()
  @IsDateString({ strict: true })
  scheduledEnd?: string;
}
