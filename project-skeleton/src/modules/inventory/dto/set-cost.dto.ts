import { IsDefined, Matches, ValidateIf } from 'class-validator';

/**
 * עלות כמחרוזת עשרונית, כמו מחיר במחירון: נכנסת ל-Decimal בלי לעבור
 * דרך float. `null` מפורש מוחק עלות שהוזנה בטעות.
 *
 * השדה חובה: עם `@IsOptional`, גוף ריק (`{}`) עבר ומחק את העלות בשקט
 * (QA 18.09, F15). מחיקה צריכה להיות כוונה, לא ברירת מחדל.
 */
export class SetCostDto {
  @IsDefined({ message: 'unitCost is required (send null to clear it)' })
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'unitCost must be a decimal string with up to 2 decimals' })
  unitCost!: string | null;
}
