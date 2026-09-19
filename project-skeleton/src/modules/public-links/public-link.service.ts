import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PublicLinkPurpose } from '@prisma/client';

import type { AppEnv } from '../../config/env.schema';
import { PrismaService } from '../../database/prisma.service';

import { generateToken, hashToken, isWellFormedToken } from './public-link.token';

const TTL_DAYS: Record<PublicLinkPurpose, number> = {
  TASK_STATUS: 30,
  BOOKING: 14,
  QUOTE: 30,
};

/** קטע ה-URL לפי מטרה. הממשק מנתב לפיו, והשרת מאמת שהוא תואם לקישור. */
export const PURPOSE_PATH: Record<PublicLinkPurpose, string> = {
  TASK_STATUS: 's',
  BOOKING: 'b',
  QUOTE: 'q',
};

type Tx = Prisma.TransactionClient;

export interface ResolvedLink {
  tenantId: string;
  link: {
    id: string;
    purpose: PublicLinkPurpose;
    customerId: string;
    taskId: string | null;
    equipmentId: string | null;
    quoteId: string | null;
    usedAt: Date | null;
  };
}

@Injectable()
export class PublicLinkService {
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppEnv, true>,
  ) {
    this.baseUrl = config.get('PUBLIC_APP_URL', { infer: true }).replace(/\/$/, '');
  }

  /**
   * יוצר קישור בתוך טרנזקציה קיימת, כדי שיישמר יחד עם הפעולה שיצרה אותו.
   *
   * לכל משימה/הצעה/ציוד יש קישור פעיל אחד לכל מטרה: הקודמים מבוטלים. אי
   * אפשר "למחזר" קישור קיים — שמור רק ה-hash שלו, לא הטוקן.
   */
  async create(
    tx: Tx,
    input: {
      tenantId: string;
      purpose: PublicLinkPurpose;
      customerId: string;
      taskId?: string;
      equipmentId?: string;
      quoteId?: string;
    },
  ): Promise<{ token: string; url: string; expiresAt: Date }> {
    const now = new Date();
    await tx.publicLink.updateMany({
      where: {
        tenantId: input.tenantId,
        purpose: input.purpose,
        revokedAt: null,
        ...(input.taskId && { taskId: input.taskId }),
        ...(input.equipmentId && { equipmentId: input.equipmentId }),
        ...(input.quoteId && { quoteId: input.quoteId }),
      },
      data: { revokedAt: now },
    });

    const token = generateToken();
    const expiresAt = new Date(now.getTime() + TTL_DAYS[input.purpose] * 86_400_000);
    await tx.publicLink.create({
      data: {
        tenantId: input.tenantId,
        tokenHash: hashToken(token),
        purpose: input.purpose,
        customerId: input.customerId,
        taskId: input.taskId ?? null,
        equipmentId: input.equipmentId ?? null,
        quoteId: input.quoteId ?? null,
        expiresAt,
      },
    });
    return { token, url: `${this.baseUrl}/c/${PURPOSE_PATH[input.purpose]}/${token}`, expiresAt };
  }

  /**
   * טוקן → טננט + קישור, לקישור בתוקף ובמטרה הנכונה בלבד.
   *
   * כל כישלון — טוקן שבור, לא קיים, פג, בוטל, מטרה אחרת — הוא אותו 404.
   * הבחנה ביניהם הייתה מלמדת מי שמנחש טוקנים משהו.
   */
  async resolve(token: string, purpose: PublicLinkPurpose): Promise<ResolvedLink> {
    const notFound = new NotFoundException('Link not found or expired');
    if (!isWellFormedToken(token)) throw notFound;

    const tokenHash = hashToken(token);
    const tenantId = await this.prisma.resolveTenantByPublicLink(tokenHash);
    if (!tenantId) throw notFound;

    const link = await this.prisma.forTenant(tenantId, (tx) =>
      tx.publicLink.findFirst({
        where: { tokenHash, tenantId, purpose, revokedAt: null, expiresAt: { gt: new Date() } },
        select: {
          id: true,
          purpose: true,
          customerId: true,
          taskId: true,
          equipmentId: true,
          quoteId: true,
          usedAt: true,
        },
      }),
    );
    if (!link) throw notFound;
    return { tenantId, link };
  }
}
