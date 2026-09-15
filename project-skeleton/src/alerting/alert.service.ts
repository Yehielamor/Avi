import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../config/env.schema';

export type AlertSeverity = 'warning' | 'critical';

export interface Alert {
  severity: AlertSeverity;
  /** קצר, יציב, וניתן לחיפוש. לא הודעה חופשית. */
  event: string;
  summary: string;
  tenantId?: string;
  context?: Record<string, unknown>;
}

/**
 * התראות תפעוליות.
 *
 * הבעיה שזה פותר: כשאירוע outbox מגיע ל-DEAD, פעולה עסקית **לא
 * התרחשה ולא תתרחש** — מלאי לא נוכה, חשבונית לא נוצרה. עד כה זה
 * נרשם ללוג ונגמר שם. אף אחד לא קורא לוגים עד שמישהו מתלונן.
 *
 * העיצוב כאן מכוון להיות משעמם: webhook אחד, בלי תלות בספק. הוא
 * עובד עם Slack, Discord, או כל דבר שמקבל POST של JSON. אם לא
 * הוגדר — ההתראה נרשמת ברמת `error` ותו לא, וזה עדיין טוב יותר
 * מ-`warn` שנבלע בין אלפי שורות.
 *
 * **לא זורק לעולם.** כשל בשליחת התראה לא אמור להפיל את הפעולה
 * שניסתה להתריע.
 */
@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly webhookUrl: string;
  private readonly environment: string;

  /**
   * דיכוי חזרות. אירוע שחוזר על עצמו אלף פעמים בדקה מציף את הערוץ
   * והופך את ההתראות לרעש שמתעלמים ממנו — מה שגרוע מלא להתריע כלל.
   */
  private readonly lastSent = new Map<string, number>();
  private static readonly DEDUPE_WINDOW_MS = 5 * 60_000;

  constructor(config: ConfigService<AppEnv, true>) {
    this.webhookUrl = config.get('ALERT_WEBHOOK_URL', { infer: true });
    this.environment = config.get('NODE_ENV', { infer: true });
  }

  async send(alert: Alert): Promise<void> {
    const key = `${alert.event}:${alert.tenantId ?? 'global'}`;
    const now = Date.now();
    const last = this.lastSent.get(key);

    if (last !== undefined && now - last < AlertService.DEDUPE_WINDOW_MS) {
      this.logger.debug({ event: alert.event }, 'Alert suppressed (duplicate within window)');
      return;
    }
    this.lastSent.set(key, now);

    // תמיד ללוג, גם כשיש webhook — הלוג הוא העקבה הקבועה.
    this.logger.error(
      { event: alert.event, tenantId: alert.tenantId, ...alert.context },
      `[${alert.severity.toUpperCase()}] ${alert.summary}`,
    );

    if (!this.webhookUrl) return;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `${alert.severity === 'critical' ? '🔴' : '🟠'} *${alert.summary}*`,
            event: alert.event,
            environment: this.environment,
            tenantId: alert.tenantId,
            context: alert.context,
            at: new Date().toISOString(),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // נרשם ונבלע. התראה שנכשלה היא בעיה, אבל להפיל בגללה את
      // הקוד שקרא לה זו בעיה גדולה יותר.
      this.logger.error({ err, event: alert.event }, 'Failed to deliver alert');
    }
  }
}
