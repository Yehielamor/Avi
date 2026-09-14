import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { AllowWhenPasswordChangeRequired } from './password-change.decorator';
import { ChangePasswordDto, LoginDto, RegisterDto } from './dto/auth.dto';

/**
 * הגבלת קצב הדוקה על נקודות האימות.
 *
 * קודם לא הייתה הגבלה כלל: `/auth/login` היה פתוח ל-credential stuffing
 * בלתי מוגבל, ו-bcrypt בעלות 12 (~300ms CPU לניסיון) הפך את זה גם
 * ל-DoS זול. המכסות הגלובליות (20/שנייה) רחבות מדי לכאן.
 * ראו docs/10-audit-findings.md#I2.
 */
const AUTH_THROTTLE = {
  short: { limit: 5, ttl: 60_000 },
  medium: { limit: 20, ttl: 15 * 60_000 },
  long: { limit: 60, ttl: 3_600_000 },
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * הרשמה עצמית. **אין שדה `role`** — התפקיד נקבע בשרת ל-FIELD תמיד.
   * המשתמש הראשון (OWNER) של טננט נוצר ב-onboarding, לא כאן.
   */
  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  register(@Req() req: Request, @Body() body: RegisterDto) {
    return this.authService.register(this.requireTenant(req), body);
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  login(@Req() req: Request, @Body() body: LoginDto) {
    return this.authService.login(this.requireTenant(req), body.email, body.password);
  }

  /** ה-route היחיד שפתוח למשתמש עם `mustChangePassword` דולק. */
  @AllowWhenPasswordChangeRequired()
  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  changePassword(@Req() req: Request, @Body() body: ChangePasswordDto) {
    const user = req.user!; // JwtAuthGuard הגלובלי כבר אימת
    return this.authService.changePassword(
      user.tenantId,
      user.id,
      body.currentPassword,
      body.newPassword,
    );
  }

  /**
   * `req.tenantId` מגיע מה-subdomain דרך TenantContextMiddleware.
   * ללא תת-דומיין אין טננט, ולכן אין למי להירשם או להתחבר — הגרסה
   * הקודמת כתבה `req.tenantId!` ונפלה על מחרוזת ריקה בתוך Prisma.
   */
  private requireTenant(req: Request): string {
    if (!req.tenantId) {
      throw new BadRequestException('Authentication must be performed on a tenant subdomain');
    }
    return req.tenantId;
  }
}
