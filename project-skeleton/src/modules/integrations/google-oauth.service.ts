import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';

import { callExternal } from './external-call.util';

// ============================================================
// שכבה דקה מעל google-auth-library. שים לב: Gmail ו-Drive חולקים
// אותו OAuth client + הסכמה משולבת (scope אחד לכל השירותים) - טננט
// מחבר "חשבון Google" פעם אחת, וזה נותן גישה גם ל-Gmail וגם ל-Drive.
//
// הערה קריטית ל-redirect_uri: Google OAuth דורש URI מדויק שרשום
// מראש ב-Google Cloud Console - **לא תומך ב-wildcard subdomains**.
// המשמעות: ה-callback URL חייב להיות בדומיין הבסיס הקבוע
// (https://yourapp.com/integrations/google/callback), לא
// tenant1.yourapp.com/... כמו שאר האפליקציה. לכן איזה טננט התחיל
// את ה-flow מקודד בפרמטר ה-state (JWT קצר-מועד), לא נלקח מה-subdomain
// (ראו integrations.controller.ts - ה-callback רץ על דומיין הבסיס,
// שם TenantContextMiddleware מדלג ולא מגדיר req.tenantId).
// ============================================================

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file', // גישה רק לקבצים שהאפליקציה עצמה יצרה/פתחה - לא לכל ה-Drive
];

// טיפוס נגזר מתוך googleapis עצמה, לא מ-google-auth-library כתלות
// נפרדת. הסיבה: googleapis מכילה עותק פנימי משלה של google-auth-library
// (דרך googleapis-common), וזה גורם לקונפליקט טיפוסים אם מתקינים גם
// את google-auth-library כחבילה עצמאית - TypeScript רואה שתי מחלקות
// OAuth2Client "זהות" מבחינה מבנית אבל ממקורות import שונים, ומסרב
// להתייחס אליהן כאותו טיפוס (private field מתנגש). הפתרון: לגזור את
// הטיפוס תמיד מ-googleapis עצמה, בכל מקום בקוד - לא לערבב מקורות.
export type GoogleAuthClient = InstanceType<typeof google.auth.OAuth2>;

@Injectable()
export class GoogleOAuthService {
  constructor(private readonly config: ConfigService) {}

  private createClient() {
    return new google.auth.OAuth2(
      this.config.get<string>('GOOGLE_CLIENT_ID'),
      this.config.get<string>('GOOGLE_CLIENT_SECRET'),
      this.config.get<string>('GOOGLE_REDIRECT_URI'),
    );
  }

  /** שלושת משתני GOOGLE_* מוגדרים. env.schema אוכף הכל-או-כלום. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('GOOGLE_CLIENT_ID'));
  }

  buildAuthUrl(state: string): string {
    // בלי client_id, גוגל מציג למשתמש דף שגיאה משלו ("invalid_client")
    // אחרי שכבר עזב את האפליקציה. 503 כאן אומר למפעיל מה חסר.
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Google integration is not configured on this server.');
    }
    const client = this.createClient();
    return client.generateAuthUrl({
      access_type: 'offline', // חובה כדי לקבל refresh_token
      prompt: 'consent', // מבטיח refresh_token גם אם המשתמש כבר אישר בעבר
      scope: GOOGLE_SCOPES,
      state,
    });
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    scopes: string[];
    expiresAt: Date | null;
  }> {
    const client = this.createClient();

    // timeout + retry מפורשים: בלי timeout, החלפת code תקועה מחזיקה
    // בקשת HTTP פתוחה ללא הגבלה. `invalid_grant` (code שכבר נוצל או
    // פג) מסווג כסופי ולא נענה ב-retry — ראו external-call.util.ts.
    const { tokens } = await callExternal(() => client.getToken(code), {
      label: 'Google token exchange',
      timeoutMs: 15_000,
      attempts: 3,
    });

    if (!tokens.access_token) {
      throw new Error('Google returned no access_token for the authorization code');
    }
    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh_token returned by Google. This happens if the tenant already granted ' +
          'consent before without prompt=consent - our buildAuthUrl always sets prompt=consent ' +
          'to avoid this, but if it still happens, the fix is to revoke app access at ' +
          'https://myaccount.google.com/permissions and reconnect.',
      );
    }

    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      scopes: (tokens.scope ?? '').split(' ').filter(Boolean),
      // נשמר כ-accessTokenExpiresAt כדי לרענן *מראש* במקום בתגובה ל-401.
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    };
  }

  // בונה client מאומת עם רענון אוטומטי (google-auth-library מרעננת
  // לבד כשהטוקן פג). onTokenRefresh נקרא כשהיא מרעננת בפועל, כדי
  // לשמור את הטוקנים המעודכנים מוצפנים חזרה ל-DB.
  createAuthenticatedClient(
    tokens: { accessToken: string; refreshToken: string },
    onTokenRefresh?: (tokens: {
      accessToken?: string | null;
      refreshToken?: string | null;
      expiryDate?: number | null;
    }) => void,
  ): GoogleAuthClient {
    const client = this.createClient();
    client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });

    if (onTokenRefresh) {
      client.on('tokens', (newTokens) => {
        // **כל** הטוקנים מועברים, לא רק ה-access_token. Google מסובבת
        // גם את ה-refresh token, והגרסה הקודמת זרקה את החדש בשקט —
        // מה שהרג את האינטגרציה בפקיעה הבאה (docs/10-audit-findings.md).
        onTokenRefresh({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token,
          expiryDate: newTokens.expiry_date,
        });
      });
    }

    return client;
  }
}
