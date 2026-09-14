import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Customer } from '@prisma/client';

import { PrismaService, type TenantClient } from '../../database/prisma.service';

const DEFAULT_PAGE_SIZE = 50;
const SEARCH_LIMIT = 10;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  // חשוב: כל query כאן מסונן ב-tenantId מפורשות בקוד - RLS הוא
  // רשת ביטחון נוספת, לא תחליף לסינון הזה (מסמך הארכיטקטורה, סעיף 8).

  async findAll(
    tenantId: string,
    opts: { take?: number; cursor?: string } = {},
  ): Promise<{ items: Customer[]; nextCursor: string | null }> {
    const take = opts.take ?? DEFAULT_PAGE_SIZE;

    const items = await this.prisma.forTenant(tenantId, (tx) =>
      tx.customer.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      }),
    );

    const nextCursor = items.length === take ? (items[items.length - 1]?.id ?? null) : null;
    return { items, nextCursor };
  }

  findOne(tenantId: string, id: string): Promise<Customer | null> {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.customer.findFirst({ where: { id, tenantId } }),
    );
  }

  /**
   * התאמה *מדויקת* לפי אימייל — המסלול של Gmail sync.
   *
   * קודם הסנכרון קרא ל-search() לכל מייל נכנס, כלומר שלוש סריקות
   * `contains` לא-מעוגנות (ILIKE '%...%', שלא יכול להשתמש באינדקס)
   * כדי לענות על שאלה שהיא שוויון פשוט. כאן זה lookup יחיד על
   * האינדקס [tenantId, email].
   */
  findByEmail(tenantId: string, email: string): Promise<Customer | null> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return Promise.resolve(null);

    return this.prisma.forTenant(tenantId, (tx) =>
      tx.customer.findFirst({
        where: { tenantId, email: normalized },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async create(
    tenantId: string,
    data: { name: string; email?: string; phone?: string; address?: string },
    actorUserId?: string,
  ): Promise<Customer> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId,
          name: data.name.trim(),
          // הנרמול חוזר גם כאן ולא רק ב-DTO: השירות נקרא גם מ-Gmail
          // sync, שלא עובר דרך ה-ValidationPipe.
          email: data.email?.trim().toLowerCase() ?? null,
          phone: data.phone?.trim() ?? null,
          address: data.address?.trim() ?? null,
        },
      });

      await this.writeAudit(tx, {
        tenantId,
        userId: actorUserId,
        action: 'customer.created',
        entityId: customer.id,
        metadata: { name: customer.name },
      });

      return customer;
    });
  }

  /**
   * חיפוש אמיתי למסך (autocomplete בטופס הידני). נשאר `contains`
   * כי זו הכוונה, אבל חסום ב-take ומחייב שני תווים לפחות — ולא
   * משמש יותר כתחליף ל-findByEmail.
   */
  search(tenantId: string, query: string, take = SEARCH_LIMIT): Promise<Customer[]> {
    const q = query.trim();
    if (q.length < 2) return Promise.resolve([]);

    return this.prisma.forTenant(tenantId, (tx) =>
      tx.customer.findMany({
        where: {
          tenantId,
          isActive: true,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: Math.min(take, SEARCH_LIMIT),
      }),
    );
  }

  private writeAudit(
    tx: TenantClient,
    entry: {
      tenantId: string;
      userId?: string;
      action: string;
      entityId: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<unknown> {
    return tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: 'Customer',
        entityId: entry.entityId,
        metadata: (entry.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
  }
}
