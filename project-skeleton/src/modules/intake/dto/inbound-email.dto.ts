import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * מה שה-Email Worker שולח על כל הודעה. ה-Worker מפרק את ה-MIME (postal-mime)
 * ושולח טקסט בלבד — קבצים מצורפים נשלחים כשמות, לא כתוכן.
 */
export class InboundEmailDto {
  /** הנמען במעטפה (SMTP RCPT TO) — הכתובת שלנו. */
  @IsString()
  @MaxLength(2000)
  to!: string;

  /** כותרת From של ההודעה. */
  @IsString()
  @MaxLength(1000)
  from!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  messageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  autoSubmitted?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  precedence?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  listId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  attachments?: string[];
}
