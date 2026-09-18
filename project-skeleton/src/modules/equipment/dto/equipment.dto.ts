import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateEquipmentDto {
  @IsString()
  @Length(1, 100)
  kind!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  model?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  location?: string;

  // חודש עד חמש שנים. מחוץ לזה זו כמעט תמיד טעות הקלדה (60 במקום 6).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  serviceIntervalMonths?: number;

  /** לציוד קיים שכבר טופל — אחרת הוא מופיע מיד כ"מגיע לטיפול". */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  lastServicedOn?: string;
}

export class UpdateEquipmentDto {
  @IsOptional() @IsString() @Length(1, 100) kind?: string;
  @IsOptional() @IsString() @Length(1, 100) model?: string;
  @IsOptional() @IsString() @Length(1, 100) location?: string;
  @IsOptional() @IsInt() @Min(1) @Max(60) serviceIntervalMonths?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) lastServicedOn?: string;
}

export class DueQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  withinDays?: number;
}

export const DAY_PARTS = ['morning', 'noon', 'evening'] as const;
export type DayPart = (typeof DAY_PARTS)[number];

export class BookingWindowDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsIn(DAY_PARTS)
  part!: DayPart;
}

export class BookingRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => BookingWindowDto)
  windows!: BookingWindowDto[];

  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
