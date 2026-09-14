import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class SearchCustomersQueryDto {
  // מינימום 2 תווים: `contains` על מחרוזת ריקה היה סריקה מלאה של
  // הטבלה שמחזירה שורות אקראיות.
  @IsString()
  @Length(2, 200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  take?: number;
}
