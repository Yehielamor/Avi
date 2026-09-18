import { IsOptional, Matches, ValidateIf } from 'class-validator';

/**
 * עלות כמחרוזת עשרונית, כמו מחיר במחירון: נכנסת ל-Decimal בלי לעבור
 * דרך float. null מוחק עלות שהוזנה בטעות.
 */
export class SetCostDto {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, { message: 'unitCost must be a decimal string with up to 2 decimals' })
  unitCost!: string | null;
}
