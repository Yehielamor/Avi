import { Injectable, Logger, NestMiddleware, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { TenantContext } from '../database/tenant-context';
import { PrismaService } from '../database/prisma.service';
import type { AppEnv } from '../config/env.schema';

declare module 'express-serve-static-core' {
  interface Request {
    tenantId?: string;
    requestId?: string;
  }
}

/**
 * המקום היחיד שבו "תת-דומיין -> טננט" מתורגם.
 *
 * שינויים מהותיים מהגרסה הקודמת:
 *
 *   • אינו מריץ יותר `SET app.current_tenant_id` על הלקוח המאוגד.
 *     זה היה הבאג המרכזי: `SET` ברמת session נדבק לחיבור ודלף
 *     לבקשה הבאה. הקונטקסט נקבע עכשיו per-transaction ב-
 *     PrismaService.forTenant(). ראו docs/10-audit-findings.md#C1.
 *
 *   • התאמת ה-host היא מדויקת, לא startsWith. קודם, טננט בשם
 *     "wwwtest" היה מדלג על זיהוי טננט לגמרי. (#M3)
 *
 *   • תת-דומיין לא מוכר מחזיר הודעה אחידה שאינה מכילה את השם —
 *     קודם אפשר היה למנות טננטים קיימים. (#I35)
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantContextMiddleware.name);
  private readonly baseDomain: string;

  /** תת-דומיינים של תשתית — לעולם לא טננטים. */
  private static readonly RESERVED = new Set(['www', 'bi', 'api', 'admin', 'static', 'cdn', 'mail']);

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.baseDomain = config.get('BASE_DOMAIN', { infer: true });
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const requestId = req.header('x-request-id') ?? randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const subdomain = this.extractSubdomain(req.headers.host ?? '');

    // ללא תת-דומיין (דומיין בסיס, או שמור) — אין טננט. זה תקין
    // עבור /health, /onboarding, ו-callback של OAuth.
    if (!subdomain) {
      TenantContext.run({ tenantId: '', requestId }, () => next());
      return;
    }

    const tenantId = await this.prisma.resolveTenantBySubdomain(subdomain);

    if (!tenantId) {
      // הודעה אחידה: לא חושפת אילו תת-דומיינים קיימים.
      this.logger.warn({ subdomain, requestId }, 'Unknown tenant subdomain');
      throw new NotFoundException('Tenant not found');
    }

    req.tenantId = tenantId;
    TenantContext.run({ tenantId, requestId }, () => next());
  }

  /**
   * מחזירה את תת-הדומיין, או null אם אין כזה.
   *
   * ההתאמה היא על מבנה ה-host המלא — לא startsWith — כדי שטננט
   * ששמו מתחיל ב-"www" לא ידלג על זיהוי.
   */
  private extractSubdomain(hostHeader: string): string | null {
    const host = hostHeader.split(':')[0]?.toLowerCase().trim();
    if (!host) return null;

    // פיתוח מקומי
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return null;

    if (host === this.baseDomain) return null;
    if (!host.endsWith(`.${this.baseDomain}`)) return null;

    const label = host.slice(0, -(this.baseDomain.length + 1));
    // תת-דומיין מרובה-רמות (a.b.example.com) אינו נתמך — הימנעות
    // מאי-בהירות.
    if (!label || label.includes('.')) return null;
    if (TenantContextMiddleware.RESERVED.has(label)) return null;

    return label;
  }
}
