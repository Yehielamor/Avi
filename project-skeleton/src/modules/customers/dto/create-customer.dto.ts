import { IsEmail, IsOptional, IsString, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCustomerDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  // מנורמל ל-lowercase+trim כדי שה-lookup המדויק מול [tenantId, email]
  // ב-Gmail sync יתאים. "Dan@X.com" ו-"dan@x.com" הם אותו לקוח.
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @Length(3, 320)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;
}
