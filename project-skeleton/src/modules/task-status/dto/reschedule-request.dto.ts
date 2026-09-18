import { IsString, Length } from 'class-validator';

export class RescheduleRequestDto {
  // טקסט חופשי מלקוח לא מזוהה. תקרה קשיחה, ומוצג בממשק כטקסט בלבד.
  @IsString()
  @Length(1, 500)
  note!: string;
}
