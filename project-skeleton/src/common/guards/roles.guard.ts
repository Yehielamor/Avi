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

import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * אכיפת התפקיד שנחתם ב-JWT.
 *
 * רץ כ-APP_GUARD *אחרי* JwtAuthGuard, ולכן `req.user` כבר קיים כאן
 * לכל route שאינו `@Public()`.
 *
 * ברירת המחדל היא "מותר" ב-route ללא `@Roles(...)` — האימות עצמו כבר
 * נאכף גלובלית. הגבול שה-guard הזה מוסיף הוא *אילו* משתמשים מאומתים
 * מורשים, והוא נדרש רק היכן שיש הבחנה.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    // `@Public()` יחד עם `@Roles()` הוא סתירה — אין משתמש לבדוק מולו.
    // נכשל סגור במקום לתת מעבר שקט.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      throw new ForbiddenException('Route is marked @Public() but also requires a role');
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
