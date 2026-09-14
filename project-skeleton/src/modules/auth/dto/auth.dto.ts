import { IsEmail, IsString, Length, Matches } from 'class-validator';

// ============================================================
// ה-ValidationPipe הגלובלי מוגדר whitelist + forbidNonWhitelisted,
// ולכן שדה שאינו כאן מוחזר ב-400. זה מה שחוסם את
// `POST /auth/register {"role":"OWNER"}` עוד לפני שהוא מגיע לשירות —
// אין ל-DTO הזה שדה `role` בכוונה, והתפקיד נקבע בשרת בלבד.
// ============================================================

/** דרישת סיסמה מינימלית. אורך הוא ההגנה האפקטיבית; מורכבות נדרשת רק כדי לחסום "123456789012". */
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{12,128}$/;

export class RegisterDto {
  @IsEmail()
  @Length(3, 254)
  email!: string;

  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'password must be 12-128 characters and contain at least one letter and one digit',
  })
  password!: string;

  @IsString()
  @Length(1, 120)
  name!: string;
}

export class LoginDto {
  @IsEmail()
  @Length(3, 254)
  email!: string;

  @IsString()
  @Length(1, 128)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  currentPassword!: string;

  @IsString()
  @Matches(PASSWORD_RULE, {
    message: 'newPassword must be 12-128 characters and contain at least one letter and one digit',
  })
  newPassword!: string;
}
