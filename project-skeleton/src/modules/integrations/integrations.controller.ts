import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request, Response } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../database/prisma.service';
import { GoogleProviderParamPipe } from './google-provider.pipe';
import { IntegrationsService, GoogleProvider } from './integrations.service';
import { OAUTH_NONCE_COOKIE, OAuthStateError, OAuthStateService } from './oauth-state.service';

// ============================================================
// מודול תשתית בלבד: OAuth, סטטוס, ניתוק.
//
// מה שהיה כאן ואיננו: לולאת "מייל → משימה". היא הייתה תלויה
// ב-Tasks, ב-Customers וב-Intake, כלומר מודול תשתית החזיק לוגיקה
// עסקית. היא עברה ל-`intake/email-intake.service.ts`, והנתיב הוא
// עכשיו `POST /intake/gmail/sync`.
// ============================================================

@Controller('integrations')
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly oauthState: OAuthStateService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  listStatus(@Req() req: Request) {
    return this.integrationsService.listStatus(req.tenantId!);
  }

  /**
   * רץ על תת-הדומיין של הטננט, ולכן `req.tenantId` קיים. ה-tenantId
   * מקודד ב-state כי ה-callback רץ על דומיין הבסיס ולא יידע אותו
   * מה-subdomain.
   *
   * ה-nonce נשמר ב-cookie ‏HttpOnly/SameSite=Lax על `.BASE_DOMAIN`,
   * כדי שיגיע גם ל-callback שעל דומיין הבסיס. זו הקשירה שמונעת
   * account-linking CSRF: תוקף שמפתה דפדפן זר ל-callback עם ה-code
   * שלו לא מחזיק את ה-cookie הזה.
   */
  @Roles(UserRole.OWNER)
  @Get('google/connect')
  connectGoogle(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { state, nonce } = this.oauthState.issue(req.tenantId!);
    res.cookie(OAUTH_NONCE_COOKIE, nonce, this.oauthState.cookieOptions());
    return { authUrl: this.integrationsService.buildGoogleAuthUrl(state) };
  }

  /**
   * Google מפנה לכאן. `@Public()` כי הבקשה מגיעה מהדפדפן אחרי
   * redirect, בלי ה-Bearer שלנו — אבל היא *לא* לא-מאומתת: ה-state
   * חתום בסוד נפרד (`OAUTH_STATE_SECRET`), נושא `aud`, חד-פעמי,
   * וקשור ל-nonce שב-cookie.
   */
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    // ה-cookie נמחק בכל מסלול יציאה. הוא חד-פעמי, ואסור שיישאר
    // בדפדפן לניסיון הבא.
    const clearNonce = () => {
      const { maxAge: _maxAge, ...opts } = this.oauthState.cookieOptions();
      res.clearCookie(OAUTH_NONCE_COOKIE, opts);
    };

    if (error) {
      clearNonce();
      throw new BadRequestException(`Google denied the authorization request: ${error}`);
    }
    if (!code || !state) {
      clearNonce();
      throw new BadRequestException('Missing code or state');
    }

    const nonce = OAuthStateService.readCookie(req.headers.cookie, OAUTH_NONCE_COOKIE);

    let tenantId: string;
    try {
      ({ tenantId } = this.oauthState.verifyAndConsume(state, nonce));
    } catch (err: unknown) {
      clearNonce();
      if (err instanceof OAuthStateError) {
        // הסיבה המדויקת נרשמת ללוג, לא מוחזרת: היא מספרת לתוקף
        // איזו מההגנות תפסה אותו.
        this.logger.warn({ reason: err.message }, 'Rejected Google OAuth callback');
        throw new BadRequestException('Invalid or expired OAuth state');
      }
      throw err;
    }

    // ה-tenantId מגיע *רק* מה-state המאומת, ולכן הכתיבה נעשית
    // תחת `forTenant(tenantId)` בתוך השירות — בלי זה ה-RLS דוחה
    // את ה-INSERT ל-tenant_integrations.
    await this.integrationsService.handleGoogleCallback(tenantId, code);
    clearNonce();

    const tenant = await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenant.findFirstOrThrow({ where: { id: tenantId }, select: { subdomain: true } }),
    );
    const baseDomain = process.env.BASE_DOMAIN ?? 'craftmind-ai.com';
    return res.redirect(
      `https://${tenant.subdomain}.${baseDomain}/settings/integrations?connected=google`,
    );
  }

  @Roles(UserRole.OWNER)
  @Delete(':provider')
  disconnect(
    @Req() req: Request,
    @Param('provider', GoogleProviderParamPipe) provider: GoogleProvider,
  ) {
    return this.integrationsService.disconnect(req.tenantId!, provider);
  }
}
