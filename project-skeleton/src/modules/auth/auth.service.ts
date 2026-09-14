import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole, Vertical } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../database/prisma.service';
import type { AppEnv } from '../../config/env.schema';

// ============================================================
// Auth בסיסי: hash+compare עם bcrypt, JWT חתום עם tenantId+userId+role.
// אין session/cookie — JWT ב-Authorization header בלבד.
//
// ה-JWT כולל tenantId, אבל ה-source of truth לכל בקשה הוא עדיין
// TenantContextMiddleware (מה-subdomain). JwtAuthGuard מוודא שהשניים
// תואמים.
// ============================================================

const BCRYPT_ROUNDS = 12;

/**
 * טענת ה-audience/purpose. בלעדיה כל טוקן שנחתם באותו סוד — למשל
 * טוקן ה-state של OAuth, שנוסע ב-query string דרך השרתים של Google —
 * מתקבל כטוקן גישה. הסודות אמנם הופרדו ב-env.schema, אבל הבדיקה כאן
 * היא זו שהופכת replay כזה לבלתי אפשרי גם אם סוד כלשהו ישותף בעתיד.
 * ראו docs/10-audit-findings.md#C6.
 */
export const ACCESS_TOKEN_AUDIENCE = 'craftmind:api';
export const ACCESS_TOKEN_ISSUER = 'craftmind:auth';
export const ACCESS_TOKEN_PURPOSE = 'access';

export interface JwtPayload {
  sub: string; // userId
  tenantId: string;
  role: UserRole;
  /** מפורש בגוף הטוקן, בנוסף ל-aud, כדי ששני מנגנונים בלתי תלויים יחסמו replay. */
  purpose: typeof ACCESS_TOKEN_PURPOSE;
  /** נגזר מ-User.mustChangePassword בזמן ההתחברות. נאכף ב-JwtAuthGuard. */
  mustChangePassword: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  mustChangePassword: boolean;
}

export interface SessionTenant {
  id: string;
  name: string;
  subdomain: string;
  vertical: Vertical;
}

export interface AuthResponse {
  accessToken: string;
  mustChangePassword: boolean;
  user: SessionUser;
  tenant: SessionTenant;
}

/** תשובת GET /auth/me — זהה, בלי טוקן חדש. */
export type SessionResponse = Omit<AuthResponse, 'accessToken'>;

/**
 * hash של סיסמה לא קיימת, לבדיקת השוואה מדומה בכניסה עם אימייל שאינו
 * קיים. בלעדיה, זמן התגובה מסגיר אילו כתובות רשומות בטננט.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1Lb0dOWyNlmL0aTD.fFY0m7fV1fW2Vy';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  /**
   * הרשמה עצמית. **התפקיד אינו מתקבל מהבקשה** — הוא תמיד `FIELD`.
   * `POST /auth/register {"role":"OWNER"}` היה הפרצה המקורית
   * (docs/20-backend-conventions.md#2). הסלמת תפקיד נעשית רק ע"י
   * OWNER קיים, או ב-onboarding שיוצר את הטננט מלכתחילה.
   */
  async register(
    tenantId: string,
    params: { email: string; password: string; name: string },
  ): Promise<AuthResponse> {
    const email = params.email.trim().toLowerCase();

    // ה-hash נעשה *לפני* פתיחת הטרנזקציה. bcrypt בעלות 12 הוא ~300ms
    // של CPU; בתוך forTenant הוא מחזיק חיבור DB לכל אותו זמן.
    const passwordHash = await bcrypt.hash(params.password, BCRYPT_ROUNDS);

    try {
      const user = await this.prisma.forTenant(tenantId, (tx) =>
        tx.user.create({
          data: { tenantId, email, passwordHash, name: params.name, role: UserRole.FIELD },
        }),
      );
      return this.buildAuthResponse(user, await this.loadTenant(tenantId));
    } catch (err: unknown) {
      // הסתמכות על האילוץ ב-DB במקום findFirst-ואז-create: השני הוא race
      // שבו שתי בקשות מקבילות עוברות שתיהן את הבדיקה.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('User with this email already exists for this tenant');
      }
      throw err;
    }
  }

  async login(tenantId: string, email: string, password: string): Promise<AuthResponse> {
    const normalized = email.trim().toLowerCase();

    const user = await this.prisma.forTenant(tenantId, (tx) =>
      tx.user.findUnique({ where: { tenantId_email: { tenantId, email: normalized } } }),
    );

    // ההשוואה רצה *מחוץ* לטרנזקציה מאותה סיבה כמו ב-register.
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.isActive || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // lastLoginAt נכתב אחרי אימות מוצלח בלבד, ב-updateMany מותנה —
    // כניסה כושלת לא מזיזה אותו.
    await this.prisma.forTenant(tenantId, (tx) =>
      tx.user.updateMany({ where: { id: user.id, tenantId }, data: { lastLoginAt: new Date() } }),
    );

    return this.buildAuthResponse(user, await this.loadTenant(tenantId));
  }

  /**
   * החלפת סיסמה. זו הדרך היחידה לנקות את `mustChangePassword`, ולכן
   * היא ה-route היחיד שמשתמש עם הדגל הדולק יכול להגיע אליו.
   */
  async changePassword(
    tenantId: string,
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<AuthResponse> {
    const user = await this.prisma.forTenant(tenantId, (tx) =>
      tx.user.findFirst({ where: { id: userId, tenantId } }),
    );
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    const updated = await this.prisma.forTenant(tenantId, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
    );

    this.logger.log({ tenantId, userId }, 'Password changed');
    return this.buildAuthResponse(updated, await this.loadTenant(tenantId));
  }

  private buildAuthResponse(
    user: {
      id: string;
      tenantId: string;
      role: UserRole;
      name: string;
      email: string;
      mustChangePassword: boolean;
    },
    tenant: SessionTenant,
  ): AuthResponse {
    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
      purpose: ACCESS_TOKEN_PURPOSE,
      mustChangePassword: user.mustChangePassword,
    };

    return {
      accessToken: this.jwt.sign(payload, {
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: ACCESS_TOKEN_ISSUER,
        expiresIn: this.config.get('JWT_EXPIRES_IN', { infer: true }),
      }),
      mustChangePassword: user.mustChangePassword,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      tenant,
    };
  }

  /**
   * טוען את פרטי הטננט לתשובת הסשן.
   *
   * רץ תחת forTenant כמו כל שאר הקוד — ה-policy על `tenants` היא
   * `id = current_tenant_id()`, ולכן זה מחזיר בדיוק שורה אחת: זו של
   * הטננט הנוכחי. אין כאן צורך בשום עקיפה.
   */
  private async loadTenant(tenantId: string): Promise<SessionTenant> {
    const tenant = await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenant.findFirst({
        where: { id: tenantId },
        select: { id: true, name: true, subdomain: true, vertical: true },
      }),
    );
    if (!tenant) throw new UnauthorizedException('Tenant not found');
    return tenant;
  }

  /**
   * שחזור סשן מטוקן קיים.
   *
   * הקליינט לא יכול להסתמך על הטוקן לבדו: המשתמש עשוי להיות מושבת,
   * התפקיד שלו שונה, או שהטננט הופסק — מאז שהטוקן הונפק. לכן זו
   * שאילתה אמיתית ל-DB ולא פענוח של ה-JWT.
   */
  async getSession(tenantId: string, userId: string): Promise<SessionResponse> {
    const [user, tenant] = await Promise.all([
      this.prisma.forTenant(tenantId, (tx) =>
        tx.user.findFirst({
          where: { id: userId, tenantId, isActive: true },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            mustChangePassword: true,
          },
        }),
      ),
      this.loadTenant(tenantId),
    ]);

    if (!user) throw new UnauthorizedException('User is no longer active');
    return { mustChangePassword: user.mustChangePassword, user, tenant };
  }

  /**
   * מאמת חתימה, תוקף, aud/iss, ו-purpose. זורק `UnauthorizedException`
   * לכל כשל — בלי להבדיל בין "פג תוקף", "חתימה שגויה" ו-"טוקן של מטרה
   * אחרת", כדי לא לתת רמז לתוקף.
   */
  verifyToken(token: string): JwtPayload {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token, {
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: ACCESS_TOKEN_ISSUER,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.purpose !== ACCESS_TOKEN_PURPOSE) {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (!payload.sub || !payload.tenantId || !Object.values(UserRole).includes(payload.role)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return payload;
  }
}
