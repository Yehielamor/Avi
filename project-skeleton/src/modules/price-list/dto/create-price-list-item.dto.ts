import { IsString, Length, Matches } from 'class-validator';

import { Trim } from '../../../common/validation/trim';

import { IsPrice } from './price.validator';

export class CreatePriceListItemDto {
  // הקוד הוא המפתח שדרכו צ'קליסטים ותבניות מצביעים על המחיר. אותו
  // צמצום תווים כמו SKU: רווח נגרר היה יוצר "קוד" שנראה זהה ולא
  // מתאים לשום דבר, והחשבונית הייתה מדלגת על השורה בשקט.
  @IsString()
  @Length(1, 64)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message: 'code may contain only letters, digits, dot, dash and underscore',
  })
  code!: string;

  @Trim()
  @IsString()
  @Length(1, 200)
  description!: string;

  @IsString()
  @IsPrice()
  price!: string;
}
