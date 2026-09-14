import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;

export class TemplateFieldDto {
  @IsString()
  @Length(1, 64)
  key!: string;

  @IsString()
  @Length(1, 120)
  label!: string;

  @IsIn(FIELD_TYPES)
  type!: (typeof FIELD_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];
}

export class TemplateChecklistItemDto {
  @IsString()
  @Length(1, 200)
  label!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  priceCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  qty?: number;
}

export class CreateJobTypeTemplateDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  /**
   * מושווה באופן מדויק מול User.skills[]. הנרמול נעשה גם כאן וגם
   * בשירות — רווח נגרר אחד הפיל את השיבוץ בשקט (audit I21).
   */
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Length(1, 64)
  requiredSkill?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateFieldDto)
  fields!: TemplateFieldDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateChecklistItemDto)
  defaultChecklist!: TemplateChecklistItemDto[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  defaultPriority?: number;
}
