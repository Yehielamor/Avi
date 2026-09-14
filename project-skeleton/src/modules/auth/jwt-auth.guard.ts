import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ALLOW_PASSWORD_CHANGE_KEY } from './password-change.decorator';

// ============================================================
// ה-guard הזה רשום כ-APP_GUARD, כלומר הוא רץ על **כל** route.
// נקודות פתוחות מסומנות ב-@Public() במפורש. הכיוון מכוון: שכחת
// סימון מייצרת 401, לא נקודה חשופה בשקט — הגרסה הקודמת דרשה
// @UseGuards בכל controller, וה-onboarding פשוט לא קיבל אותו.
//
// הוא עושה שלושה דברים:
//   1. אימות ה-JWT (כולל aud/purpose — טוקן state של OAuth אינו טוקן גישה)
//   2. tenant consistency: payload.tenantId === req.tenantId (מה-subdomain)
//   3. אכיפת mustChangePassword
// ============================================================

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; tenantId: string; role: UserRole; mustChangePassword: boolean };
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // רק בקשות HTTP. ל-context אחר (למשל עובד BullMQ) אין authorization header.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }

    const payload = this.authService.verifyToken(authHeader.slice('Bearer '.length).trim());

    // בלי הבדיקה הזו, JWT תקין של tenant1 נשלח אל tenant2.yourapp.com.
    // ה-RLS היה חוסם ברמת השורה, אבל כאן זה נתפס מוקדם ועם 403 ברור.
    if (!req.tenantId || payload.tenantId !== req.tenantId) {
      throw new ForbiddenException('Token does not match tenant for this request');
    }

    if (payload.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PASSWORD_CHANGE_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException('Password change required before using the API');
      }
    }

    req.user = {
      id: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role,
      mustChangePassword: payload.mustChangePassword,
    };
    return true;
  }
}
