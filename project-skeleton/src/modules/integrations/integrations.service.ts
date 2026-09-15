import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';

import {
  DecryptionKeyMissingError,
  decryptSecret,
  encryptSecretVersioned,
} from '../../common/crypto.util';
import { AlertService } from '../../alerting/alert.service';
import { PrismaService } from '../../database/prisma.service';
import { Connector } from './connector.interface';
import { DriveConnector } from './drive.connector';
import { GmailConnector } from './gmail.connector';
import { GoogleOAuthService } from './google-oauth.service';
import { IntegrationAuthError, callExternal } from './external-call.util';

export type GoogleProvider = Extract<IntegrationProvider, 'GMAIL' | 'DRIVE'>;

// ============================================================
// ה-registry שממנו שאר האפליקציה מקבלת connector מוכן (סעיף 3).
//
// ------------------------------------------------------------
// מה תוקן כאן
// ------------------------------------------------------------
//
// א. כל שאילתה עוברת `forTenant`. תחת ה-RLS החדש, `prisma.tenantIntegration`
//    הישיר פשוט זורק.
//
// ב. **רענון טוקן.** ה-callback של `onTokenRefresh` היה fire-and-forget
//    (בלי `await`) ושמר *רק* את ה-`access_token`. כש-Google מסובבת את
//    ה-refresh token — מה שקורה — הטוקן החדש נזרק, והאינטגרציה מתה
//    בפקיעה הבאה בלי שאף אחד ידע למה. עכשיו: `await`, שני הטוקנים,
//    וגם `accessTokenExpiresAt`.
//
// ג. **סטטוס.** `invalid_grant`/401 מעביר ל-`EXPIRED` עם `lastError`,
//    במקום להשאיר `CONNECTED` לנצח ולהחזיר 500 אטום לטננט.
//
// ד. **גרסת מפתח הצפנה** נכתבת ל-`encryptionKeyVersion`, כך שרוטציה
//    של `INTEGRATION_ENCRYPTION_KEY` לא הורסת טוקנים קיימים.
// ============================================================

const GOOGLE_PROVIDERS: readonly GoogleProvider[] = ['GMAIL', 'DRIVE'] as const;

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly alerts: AlertService,
    private readonly prisma: PrismaService,
    private readonly googleOAuth: GoogleOAuthService,
  ) {}

  // --- OAuth flow (הסכמה אחת מול Google מכסה גם Gmail וגם Drive) ---

  buildGoogleAuthUrl(state: string): string {
    return this.googleOAuth.buildAuthUrl(state);
  }

  /**
   * ה-callback רץ על דומיין הבסיס, בלי `req.tenantId` — ה-tenantId
   * מגיע *אך ורק* מטוקן ה-state המאומת. הכתיבה עצמה עטופה ב-`forTenant`,
   * אחרת ה-RLS דוחה את ה-INSERT ל-`tenant_integrations`.
   *
   * החלפת ה-code מול Google נעשית *לפני* פתיחת הטרנזקציה: קריאת רשת
   * בתוך `forTenant` מחזיקה חיבור DB לכל משך הקריאה.
   */
  async handleGoogleCallback(tenantId: string, code: string): Promise<void> {
    const { accessToken, refreshToken, scopes, expiresAt } =
      await this.googleOAuth.exchangeCode(code);

    const access = encryptSecretVersioned(accessToken);
    const refresh = encryptSecretVersioned(refreshToken);

    await this.prisma.forTenant(tenantId, async (tx) => {
      for (const provider of GOOGLE_PROVIDERS) {
        const shared = {
          accessTokenEncrypted: access.ciphertext,
          refreshTokenEncrypted: refresh.ciphertext,
          encryptionKeyVersion: access.keyVersion,
          accessTokenExpiresAt: expiresAt,
          scopes,
          status: 'CONNECTED' as const,
          // חיבור מחדש מנקה שגיאה ישנה — אחרת lastError של לפני חודש
          // נראה כמו תקלה נוכחית במסך הסטטוס.
          lastError: null,
          lastErrorAt: null,
        };
        await tx.tenantIntegration.upsert({
          where: { tenantId_provider: { tenantId, provider } },
          update: shared,
          create: { tenantId, provider, ...shared },
        });
      }
    });

    this.logger.log({ tenantId }, 'Google integration connected (Gmail + Drive)');
  }

  async disconnect(tenantId: string, provider: GoogleProvider): Promise<{ disconnected: number }> {
    const { count } = await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.updateMany({
        where: { tenantId, provider },
        data: {
          status: 'DISCONNECTED',
          accessTokenEncrypted: null,
          refreshTokenEncrypted: null,
          syncCursor: null,
        },
      }),
    );
    return { disconnected: count };
  }

  listStatus(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.findMany({
        where: { tenantId },
        select: {
          provider: true,
          status: true,
          lastError: true,
          lastErrorAt: true,
          lastSyncedAt: true,
          updatedAt: true,
        },
      }),
    );
  }

  /** ה-watermark של Gmail sync, נקרא לפני הסנכרון ונכתב אחריו. */
  async getSyncState(
    tenantId: string,
    provider: GoogleProvider,
  ): Promise<{ lastSyncedAt: Date | null; syncCursor: string | null }> {
    const row = await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.findFirst({
        where: { tenantId, provider },
        select: { lastSyncedAt: true, syncCursor: true },
      }),
    );
    return { lastSyncedAt: row?.lastSyncedAt ?? null, syncCursor: row?.syncCursor ?? null };
  }

  async recordSyncSuccess(
    tenantId: string,
    provider: GoogleProvider,
    syncedAt: Date,
    syncCursor: string | null,
  ): Promise<void> {
    await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.updateMany({
        where: { tenantId, provider },
        data: { lastSyncedAt: syncedAt, syncCursor, lastError: null, lastErrorAt: null },
      }),
    );
  }

  /**
   * מסמן אינטגרציה כפגה. נקרא מכל מסלול שתפס `IntegrationAuthError` —
   * זו הנקודה שבה הטננט מקבל הודעה אמיתית במקום 500 אטום שחוזר לנצח.
   */
  async markExpired(tenantId: string, provider: GoogleProvider, reason: string): Promise<void> {
    await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.updateMany({
        where: { tenantId, provider },
        data: {
          status: 'EXPIRED',
          // חיתוך: הודעת שגיאה של ספק יכולה להיות ארוכה מאוד, ואין
          // סיבה לשמור אותה שלמה בעמודה שמוצגת ב-UI.
          lastError: reason.slice(0, 500),
          lastErrorAt: new Date(),
        },
      }),
    );
    this.logger.warn({ tenantId, provider, reason }, 'Integration marked EXPIRED');

    // הטננט מנותק וכנראה לא יודע: הסנכרון פשוט מפסיק להביא מיילים,
    // ומשימות חדשות לא נוצרות. כשל שקט שעולה לקוחות.
    await this.alerts.send({
      severity: 'warning',
      event: 'integration.expired',
      summary: `${provider} integration expired — email intake has stopped for this tenant`,
      tenantId,
      context: { provider, reason: reason.slice(0, 300) },
    });
  }

  async markError(tenantId: string, provider: GoogleProvider, reason: string): Promise<void> {
    await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.updateMany({
        where: { tenantId, provider },
        data: { status: 'ERROR', lastError: reason.slice(0, 500), lastErrorAt: new Date() },
      }),
    );
  }

  // --- Factory ---------------------------------------------------------------

  async getConnector(tenantId: string, provider: GoogleProvider): Promise<Connector> {
    const integration = await this.prisma.forTenant(tenantId, (tx) =>
      tx.tenantIntegration.findFirst({
        where: { tenantId, provider },
        select: {
          status: true,
          accessTokenEncrypted: true,
          refreshTokenEncrypted: true,
          encryptionKeyVersion: true,
          lastError: true,
        },
      }),
    );

    if (!integration) {
      throw new NotFoundException(`${provider} is not connected for this tenant`);
    }
    if (integration.status === 'EXPIRED') {
      // 503 ולא 404: החיבור *היה* קיים, והפעולה הנדרשת היא חיבור
      // מחדש. ההודעה כוללת את הסיבה שנשמרה, כדי שהטננט ידע מה קרה.
      throw new ServiceUnavailableException(
        `${provider} authorization expired and must be reconnected` +
          (integration.lastError ? `: ${integration.lastError}` : ''),
      );
    }
    if (
      integration.status !== 'CONNECTED' ||
      !integration.accessTokenEncrypted ||
      !integration.refreshTokenEncrypted
    ) {
      throw new NotFoundException(`${provider} is not connected for this tenant`);
    }

    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = decryptSecret(
        integration.accessTokenEncrypted,
        integration.encryptionKeyVersion,
      );
      refreshToken = decryptSecret(
        integration.refreshTokenEncrypted,
        integration.encryptionKeyVersion,
      );
    } catch (err: unknown) {
      if (err instanceof DecryptionKeyMissingError) {
        // בעיית deploy, לא בעיית טננט: המפתח הישן לא נטען. מסומן
        // ERROR ולא EXPIRED — הטוקן עצמו אולי עדיין תקף, וחיבור מחדש
        // יסתיר תקלת קונפיגורציה אמיתית.
        await this.markError(tenantId, provider, err.message);
        throw new ServiceUnavailableException(
          `${provider} credentials cannot be decrypted with the keys currently configured`,
        );
      }
      throw err;
    }

    const authClient = this.googleOAuth.createAuthenticatedClient(
      { accessToken, refreshToken },
      // ה-listener הזה נורה מתוך google-auth-library, שלא ממתין לו.
      // לכן ההמתנה כאן פנימית: `persistRefreshedTokens` היא async,
      // וכל כשל שלה נרשם — במקום להיעלם כ-unhandled rejection.
      (newTokens) => {
        void this.persistRefreshedTokens(tenantId, provider, newTokens);
      },
    );

    return provider === 'GMAIL' ? new GmailConnector(authClient) : new DriveConnector(authClient);
  }

  /**
   * שומר טוקנים שסובבו.
   *
   * הגרסה הקודמת שמרה **רק** `access_token`. Google מסובבת גם את
   * ה-refresh token (בפרט אחרי ביטול/חידוש הסכמה), ואז הטוקן החדש
   * נזרק ואנחנו ממשיכים להחזיק ישן שכבר בוטל — האינטגרציה מתה
   * בפקיעה הבאה ואי אפשר לשחזר בלי חיבור מחדש ידני.
   */
  private async persistRefreshedTokens(
    tenantId: string,
    provider: GoogleProvider,
    tokens: {
      accessToken?: string | null;
      refreshToken?: string | null;
      expiryDate?: number | null;
    },
  ): Promise<void> {
    const data: {
      accessTokenEncrypted?: string;
      refreshTokenEncrypted?: string;
      encryptionKeyVersion?: number;
      accessTokenExpiresAt?: Date;
    } = {};

    if (tokens.accessToken) {
      const enc = encryptSecretVersioned(tokens.accessToken);
      data.accessTokenEncrypted = enc.ciphertext;
      data.encryptionKeyVersion = enc.keyVersion;
    }
    if (tokens.refreshToken) {
      const enc = encryptSecretVersioned(tokens.refreshToken);
      data.refreshTokenEncrypted = enc.ciphertext;
      data.encryptionKeyVersion = enc.keyVersion;
    }
    if (tokens.expiryDate) {
      data.accessTokenExpiresAt = new Date(tokens.expiryDate);
    }

    if (Object.keys(data).length === 0) return;

    try {
      await callExternal(
        () =>
          this.prisma.forTenant(tenantId, (tx) =>
            tx.tenantIntegration.updateMany({ where: { tenantId, provider }, data }),
          ),
        { label: `persist refreshed ${provider} tokens`, attempts: 3, timeoutMs: 5_000 },
      );
    } catch (err: unknown) {
      // כשל כאן לא מפיל את הבקשה שבמהלכה הרענון קרה — אבל הוא *חייב*
      // להיראות: הטוקן החדש אבד, וההשפעה תתגלה רק בפקיעה הבאה.
      this.logger.error(
        { err, tenantId, provider },
        'Failed to persist refreshed Google tokens — the rotated token was lost',
      );
    }
  }

  /**
   * מריץ פעולה מול ספק ומתרגם כשל הרשאה לסטטוס מתמשך. זה המסלול
   * שכל קורא חיצוני אמור להשתמש בו במקום לקרוא ל-connector ישירות.
   */
  async withConnector<T>(
    tenantId: string,
    provider: GoogleProvider,
    fn: (connector: Connector) => Promise<T>,
  ): Promise<T> {
    const connector = await this.getConnector(tenantId, provider);
    try {
      await connector.ensureAuthenticated();
      return await fn(connector);
    } catch (err: unknown) {
      if (err instanceof IntegrationAuthError) {
        await this.markExpired(tenantId, provider, err.message);
        throw new ServiceUnavailableException(
          `${provider} authorization expired and must be reconnected`,
        );
      }
      throw err;
    }
  }
}
