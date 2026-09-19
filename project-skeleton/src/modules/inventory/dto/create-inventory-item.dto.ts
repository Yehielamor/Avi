import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// ValidationPipe גלובלי עם whitelist + forbidNonWhitelisted: שדה
// שאינו כאן מוחזר ב-400 ולא מגיע ל-prisma.create. tenantId בפירוש
// *אינו* כאן — הוא מגיע מה-subdomain בלבד (קונבנציות, סעיף 2).
export class CreateInventoryItemDto {
  @IsString()
  @Length(1, 64)
  // SKU נכנס לאינדקס ייחודי ולשאילתות raw; צמצום לתווים בטוחים חוסך
  // הפתעות (רווחים נגררים שיוצרים "פריט כפול" שנראה זהה).
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'sku may contain only letters, digits, dot, dash and underscore' })
  sku!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  lowStockThreshold?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  unitPrice?: number;

  // עלות קנייה — בסיס דו"ח הרווחיות. אותו פורמט כמו unitPrice.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  unitCost?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;
}
