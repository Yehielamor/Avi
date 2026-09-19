import { IsString, Length } from 'class-validator';

import { Trim } from '../../../common/validation/trim';

export class RescheduleRequestDto {
  // טקסט חופשי מלקוח לא מזוהה. תקרה קשיחה, ומוצג בממשק כטקסט בלבד.
  @Trim()
  @IsString()
  @Length(1, 500)
  note!: string;
}
