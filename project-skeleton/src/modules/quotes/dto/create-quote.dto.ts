import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class CreateQuoteDto {
  @IsUUID()
  customerId!: string;

  /**
   * קודי מחיר בלבד, כל קוד פעם אחת, בלי כמות.
   *
   * החשבונית מחייבת כל קוד פעם אחת למשימה (@@unique([taskId, priceCode])).
   * הצעה עם "2 ×" הייתה מאושרת על סכום אחד ומחויבת על סכום אחר.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  priceCodes!: string[];

  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  validDays?: number;
}
