import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// הסכימה תומכת במפורש בוורטיקל RETAIL (50k SKU לטננט). endpoint
// שמחזיר את כל הטבלה בלי תקרה הוא DoS על עצמנו — ראו findAll.
export class ListInventoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
