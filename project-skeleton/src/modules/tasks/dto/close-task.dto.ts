import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * ה-checklist הנסגר מוזן ישירות ל-Inventory (sku/qty) ול-Invoicing
 * (priceCode). קודם הוא הגיע כ-`unknown` ונשמר כמו שהוא, כך ש-qty
 * שלילי או sku ריק הגיעו עד לניכוי המלאי.
 */
export class ChecklistItemDto {
  @IsString()
  @Length(1, 200)
  label!: string;

  @IsBoolean()
  done!: boolean;

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

export class CloseTaskDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  checklist?: ChecklistItemDto[];
}
