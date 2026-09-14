import { Type } from 'class-transformer';
import { IsDate, IsUUID } from 'class-validator';

/**
 * `@Body() body: { ... }` הישן לא היה DTO — ה-ValidationPipe הגלובלי
 * לא ראה אותו, ולכן `whitelist`/`forbidNonWhitelisted` לא חלו עליו
 * בכלל. ראו docs/20-backend-conventions.md §2.
 *
 * `tenantId` לא מופיע כאן במכוון: הוא מגיע מ-`req.tenantId` בלבד.
 */
export class GenerateInvoiceDto {
  @IsUUID()
  customerId!: string;

  @Type(() => Date)
  @IsDate({ message: 'periodStart must be a valid ISO 8601 date string' })
  periodStart!: Date;

  @Type(() => Date)
  @IsDate({ message: 'periodEnd must be a valid ISO 8601 date string' })
  periodEnd!: Date;
}
