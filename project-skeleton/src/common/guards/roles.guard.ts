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

import { ANY_ROLE_KEY, ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * אכיפת התפקיד שנחתם ב-JWT.
 *
 * רץ כ-APP_GUARD *אחרי* JwtAuthGuard, ולכן `req.user` כבר קיים כאן
 * לכל route שאינו `@Public()`.
 *
 * **כשל סגור.** route שאינו מסומן `@Roles(...)`, `@AnyRole()` או
 * `@Public()` נדחה ב-403.
 *
 * קודם ברירת המחדל הייתה "מותר", ואז נקודה חדשה שמישהו שכח לסמן
 * הייתה פתוחה לכל תפקיד מאומת — כולל טכנאי שטח שמנתק את חשבון
 * Google של העסק. הכיוון הזה הופך שכחה לשגיאה גלויה במקום לחור שקט,
 * בדיוק כמו `@Public()` מול JwtAuthGuard.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // `@Public()` יחד עם `@Roles()` הוא סתירה — אין משתמש לבדוק מולו.
    if (isPublic && required && required.length > 0) {
      throw new ForbiddenException('Route is marked @Public() but also requires a role');
    }

    // route ציבורי אינו זקוק לתפקיד.
    if (isPublic) return true;

    const anyRole = this.reflector.getAllAndOverride<boolean | undefined>(ANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      if (anyRole) return true;
      // לא סומן כלום. זו טעות של מפתח, לא של המשתמש — ולכן היא
      // נרשמת כדי שתתגלה, ולא נבלעת.
      throw new ForbiddenException(
        'This route declares no access policy. Add @Roles(...), @AnyRole() or @Public().',
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Authentication required');

    if (!required.includes(user.role)) {
      throw new ForbiddenException('Your role is not permitted to perform this action');
    }

    return true;
  }
}
