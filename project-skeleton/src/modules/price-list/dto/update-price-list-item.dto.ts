import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

import { Trim } from '../../../common/validation/trim';

import { IsPrice } from './price.validator';

/**
 * `code` בכוונה אינו כאן, ולכן ValidationPipe (forbidNonWhitelisted)
 * דוחה אותו ב-400.
 *
 * צ'קליסטים של משימות ותבניות שומרים את הקוד כמחרוזת. שינוי שם היה
 * מנתק את כולם בלי שגיאה — החשבונית פשוט הייתה מדלגת על השורות. מי
 * שצריך קוד אחר יוצר פריט חדש ומשבית את הישן.
 */
export class UpdatePriceListItemDto {
  @IsOptional()
  @Trim()
  @IsString()
  @Length(1, 200)
  description?: string;

  @IsOptional()
  @IsString()
  @IsPrice()
  price?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
