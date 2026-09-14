import { IsInt, IsOptional, IsString, Length, Max, Min, NotEquals } from 'class-validator';

// היה `@Body('delta') delta: number` — כלומר כל JSON עבר, כולל
// מחרוזת או NaN, ישר לתוך `{ increment: delta }`.
export class AdjustQuantityDto {
  @IsInt()
  @NotEquals(0)
  @Min(-1_000_000)
  @Max(1_000_000)
  delta!: number;

  // נשמר ב-StockMovement.note — זה מה שהופך "מי הוריד 40 יחידות"
  // לשאלה עם תשובה.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
