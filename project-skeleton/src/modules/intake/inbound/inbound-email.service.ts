import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AppEnv } from '../../../config/env.schema';
import { PrismaService } from '../../../database/prisma.service';
import type { InboundEmailDto } from '../dto/inbound-email.dto';
import { EmailIntakeService } from '../email-intake.service';

import { automatedReason, generateLocalPart, gmailVerification, localPartFor, sourceIdFor, unwrapForwarded } from './inbound-mail';

export type InboundOutcome =
  | { kind: 'created'; taskId: string }
  | { kind: 'duplicate' }
  | { kind: 'verification' }
  | { kind: 'ignored'; reason: string };

/**
 * קליטת מייל בהעברה אוטומטית (ADR 0001).
 *
 * העסק מגדיר ב-Gmail העברה לכתובת שלו אצלנו; Cloudflare מקבל את הדואר,
 * ה-Worker שולח אותו חתום לכאן, ומכאן — אותו מסלול כמו Gmail
 * (`EmailIntakeService.ingest`): לקוח, חילוץ LLM, משימה.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);
  private readonly domain: string;
  readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly intake: EmailIntakeService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.domain = config.get('INBOUND_EMAIL_DOMAIN', { infer: true });
    this.secret = config.get('INBOUND_EMAIL_SECRET', { infer: true });
  }

  get enabled(): boolean {
    return this.secret !== '';
  }

  async receive(dto: InboundEmailDto): Promise<InboundOutcome> {
    if (!this.enabled) throw new ServiceUnavailableException('Inbound email is not configured');

    // כתובת לא מוכרת — 404, וה-Worker דוחה את ההודעה מול השולח.
    // בלי פירוט: לא מאשרים לזר אילו כתובות קיימות.
    const localPart = localPartFor(dto.to, this.domain);
    const tenantId = localPart ? await this.prisma.resolveTenantByInboundMailbox(localPart) : null;
    if (!tenantId) throw new NotFoundException('Unknown address');

    const msg = {
      from: dto.from,
      subject: dto.subject?.trim() ?? '',
      text: dto.text ?? '',
      messageId: dto.messageId,
      autoSubmitted: dto.autoSubmitted,
      precedence: dto.precedence,
      listId: dto.listId,
    };

    const verification = gmailVerification(msg);
    if (verification) {
      await this.prisma.forTenant(tenantId, (tx) =>
        tx.inboundMailbox.update({
          where: { tenantId },
          data: {
            verificationCode: verification.code,
            verificationUrl: verification.url,
            verificationReceivedAt: new Date(),
          },
        }),
      );
      this.logger.log({ tenantId }, 'Gmail forwarding verification received');
      return { kind: 'verification' };
    }

    // נספר גם מה שלא הופך למשימה: "הגיע מייל" הוא האות שההעברה עובדת.
    await this.prisma.forTenant(tenantId, (tx) =>
      tx.inboundMailbox.update({
        where: { tenantId },
        data: { lastReceivedAt: new Date(), receivedCount: { increment: 1 } },
      }),
    );

    const automated = automatedReason(msg);
    if (automated) return { kind: 'ignored', reason: automated };

    // העברה ידנית: הלקוח האמיתי בתוך הגוף, לא בעל העסק ששלח.
    const inner = unwrapForwarded(msg.text);
    const attachments = dto.attachments?.length ? `\n\n[קבצים מצורפים: ${dto.attachments.join(', ')}]` : '';

    const result = await this.intake.ingest(tenantId, {
      sourceId: sourceIdFor(msg),
      from: inner?.from ?? msg.from,
      subject: inner?.subject ?? msg.subject.replace(/^\s*(fwd?|הועבר)\s*:\s*/i, ''),
      bodyText: (inner?.body ?? msg.text) + attachments,
    });
    return result.kind === 'created' ? { kind: 'created', taskId: result.taskId } : { kind: 'duplicate' };
  }

  /** הכתובת של העסק, ונוצרת בפעם הראשונה שמבקשים אותה. */
  async mailbox(tenantId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const existing = await tx.inboundMailbox.findUnique({ where: { tenantId } });
      if (existing) return this.view(existing);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subdomain: true } });
      const created = await tx.inboundMailbox.upsert({
        where: { tenantId },
        create: { tenantId, localPart: generateLocalPart(tenant.subdomain) },
        update: {},
      });
      return this.view(created);
    });
  }

  /**
   * כתובת חדשה, והישנה מפסיקה לעבוד מיד. למקרה שהכתובת דלפה ומגיע ספאם.
   * בעל העסק צריך לעדכן את ההעברה ב-Gmail — ולכן גם קוד האימות מתאפס.
   */
  async rotate(tenantId: string, actorId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { subdomain: true } });
      const localPart = generateLocalPart(tenant.subdomain);
      const updated = await tx.inboundMailbox.upsert({
        where: { tenantId },
        create: { tenantId, localPart },
        update: { localPart, verificationCode: null, verificationUrl: null, verificationReceivedAt: null },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorId,
          action: 'inbound_mailbox.rotated',
          entityType: 'InboundMailbox',
          entityId: tenantId,
          metadata: {},
        },
      });
      return this.view(updated);
    });
  }

  private view(m: {
    localPart: string;
    verificationCode: string | null;
    verificationUrl: string | null;
    verificationReceivedAt: Date | null;
    lastReceivedAt: Date | null;
    receivedCount: number;
  }) {
    return {
      enabled: this.enabled,
      address: `${m.localPart}@${this.domain}`,
      verificationCode: m.verificationCode,
      verificationUrl: m.verificationUrl,
      verificationReceivedAt: m.verificationReceivedAt,
      lastReceivedAt: m.lastReceivedAt,
      receivedCount: m.receivedCount,
    };
  }
}
