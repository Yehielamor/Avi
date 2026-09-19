import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PublicLinkPurpose, QuoteStatus, TaskSource, TaskStatus } from '@prisma/client';

import { buildWaLink } from '../../common/phone.util';
import { PrismaService } from '../../database/prisma.service';
import { PublicLinkService } from '../public-links/public-link.service';

import type { CreateQuoteDto } from './dto/create-quote.dto';

type Tx = Prisma.TransactionClient;

const DEFAULT_VALID_DAYS = 30;
/** הגדול ביותר ש-`Decimal(12, 2)` (quotes.totalAmount) מחזיק. */
const MAX_AMOUNT = new Prisma.Decimal('9999999999.99');

/** מפתח נעילה לטננט, במרחב נפרד מזה של החשבוניות (FNV-1a 32-bit). */
function quoteLockKey(tenantId: string): bigint {
  const key = `quote:${tenantId}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return BigInt(hash >>> 0);
}

const quoteInclude = {
  customer: { select: { id: true, name: true } },
  lines: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.QuoteInclude;

/**
 * הצעות מחיר.
 *
 * ההצעה בנויה רק מהמחירון, וכל שורה היא **עותק** של המחיר ברגע ההצעה —
 * שינוי מחירון אחר כך לא משנה הצעה שכבר נשלחה ללקוח. אישור ההצעה יוצר
 * משימה שהצ'קליסט שלה הוא שורות ההצעה, כך שהחשבונית בסוף מחייבת בדיוק
 * את מה שהלקוח אישר.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: PublicLinkService,
  ) {}

  async list(tenantId: string) {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.quote.findMany({ where: { tenantId }, include: quoteInclude, orderBy: { createdAt: 'desc' }, take: 100 }),
    );
  }

  async get(tenantId: string, id: string) {
    const quote = await this.prisma.forTenant(tenantId, (tx) =>
      tx.quote.findFirst({ where: { id, tenantId }, include: quoteInclude }),
    );
    if (!quote) throw new NotFoundException('Quote not found');
    return quote;
  }

  async create(tenantId: string, dto: CreateQuoteDto, actorId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({ where: { id: dto.customerId, tenantId }, select: { id: true } });
      if (!customer) throw new NotFoundException('Customer not found');

      const items = await tx.priceListItem.findMany({
        where: { tenantId, isActive: true, code: { in: dto.priceCodes } },
        select: { code: true, description: true, price: true },
      });
      const byCode = new Map(items.map((i) => [i.code, i]));
      const missing = dto.priceCodes.filter((c) => !byCode.has(c));
      if (missing.length > 0) {
        // הצעה עם שורה שאינה במחירון הייתה מתומחרת באפס בחשבונית.
        throw new BadRequestException(`Unknown or inactive price codes: ${missing.join(', ')}`);
      }

      const lines = dto.priceCodes.map((code, position) => {
        const item = byCode.get(code)!;
        const unitPrice = new Prisma.Decimal(item.price);
        return { priceCode: code, description: item.description, qty: 1, unitPrice, amount: unitPrice, position };
      });
      // Decimal מתחילתו ועד סופו (קונבנציות, סעיף 4).
      const totalAmount = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));
      // כל מחיר בודד תקין (PRICE_PATTERN), אבל הסכום של כמה מהם יכול לחרוג
      // מהעמודה — ואז Postgres נופל ב-numeric overflow וזה 500 (QA 18.09, F13).
      if (totalAmount.greaterThan(MAX_AMOUNT)) {
        throw new BadRequestException('The quote total is larger than the maximum amount (9,999,999,999.99)');
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${quoteLockKey(tenantId)}::bigint)`;
      const rows = await tx.$queryRaw<Array<{ next: bigint }>>`
        SELECT COALESCE(MAX("quoteNumber"), 0) + 1 AS next FROM quotes WHERE "tenantId" = ${tenantId}::uuid
      `;
      const next = rows[0]?.next;
      if (next === undefined) throw new Error('Failed to allocate a quote number');

      const quote = await tx.quote.create({
        data: {
          tenantId,
          customerId: dto.customerId,
          quoteNumber: Number(next),
          notes: dto.notes?.trim() || null,
          totalAmount,
          validUntil: new Date(Date.now() + (dto.validDays ?? DEFAULT_VALID_DAYS) * 86_400_000),
          lines: { create: lines.map((l) => ({ ...l, tenantId })) },
        },
        include: quoteInclude,
      });
      await this.audit(tx, tenantId, actorId, 'quote.created', quote.id, {
        quoteNumber: quote.quoteNumber,
        total: totalAmount.toString(),
      });
      return quote;
    });
  }

  async send(tenantId: string, id: string, actorId: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          status: true,
          quoteNumber: true,
          totalAmount: true,
          validUntil: true,
          customerId: true,
          customer: { select: { phone: true } },
          tenant: { select: { name: true } },
        },
      });
      if (!quote) throw new NotFoundException('Quote not found');
      if (quote.status === QuoteStatus.APPROVED || quote.status === QuoteStatus.DECLINED) {
        throw new ConflictException('This quote was already answered');
      }
      if (quote.validUntil <= new Date()) throw new ConflictException('This quote has expired');

      const { url } = await this.links.create(tx, {
        tenantId,
        purpose: PublicLinkPurpose.QUOTE,
        customerId: quote.customerId,
        quoteId: id,
      });
      if (quote.status === QuoteStatus.DRAFT) {
        await tx.quote.update({ where: { id }, data: { status: QuoteStatus.SENT } });
      }
      await this.audit(tx, tenantId, actorId, 'quote.sent', id, {});

      const total = formatIls(quote.totalAmount);
      const message =
        `שלום, כאן ${quote.tenant.name}. מצורפת הצעת מחיר מס' ${quote.quoteNumber} על סך ${total}. ` +
        `אפשר לראות את הפירוט ולאשר כאן: ${url}`;
      return { url, waUrl: buildWaLink(quote.customer.phone, message), message };
    });
  }

  // ---------------------------------------------------------------------------
  // צד הלקוח
  // ---------------------------------------------------------------------------

  async publicView(token: string) {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.QUOTE);
    return this.prisma.forTenant(tenantId, async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id: link.quoteId!, tenantId },
        select: {
          quoteNumber: true,
          status: true,
          notes: true,
          totalAmount: true,
          validUntil: true,
          createdAt: true,
          lines: { orderBy: { position: 'asc' }, select: { description: true, amount: true } },
          tenant: { select: { name: true } },
        },
      });
      if (!quote) throw new NotFoundException('Link not found or expired');
      const expired = quote.validUntil <= new Date();
      return {
        businessName: quote.tenant.name,
        quoteNumber: quote.quoteNumber,
        createdAt: quote.createdAt,
        validUntil: quote.validUntil,
        notes: quote.notes,
        lines: quote.lines.map((l) => ({ description: l.description, amount: l.amount.toString() })),
        totalAmount: quote.totalAmount.toString(),
        status: expired && quote.status === QuoteStatus.SENT ? QuoteStatus.EXPIRED : quote.status,
        canRespond: quote.status === QuoteStatus.SENT && !expired,
      };
    });
  }

  /**
   * אישור → משימה, בטרנזקציה אחת.
   *
   * אטומי פעמיים: ה-updateMany מעביר SENT→APPROVED רק פעם אחת, ו-`Quote.taskId`
   * ייחודי. לחיצה כפולה או רענון מקבלים את אותה תוצאה, לא שתי משימות.
   */
  async approve(token: string) {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.QUOTE);
    await this.prisma.forTenant(tenantId, async (tx) => {
      const now = new Date();
      const { count } = await tx.quote.updateMany({
        where: { id: link.quoteId!, tenantId, status: QuoteStatus.SENT, validUntil: { gt: now } },
        data: { status: QuoteStatus.APPROVED, approvedAt: now },
      });
      if (count === 0) {
        const current = await tx.quote.findFirst({ where: { id: link.quoteId!, tenantId }, select: { status: true } });
        if (current?.status === QuoteStatus.APPROVED) return; // כבר אושרה — אידמפוטנטי
        throw new ConflictException('This quote can no longer be approved');
      }

      const quote = await tx.quote.findFirstOrThrow({
        where: { id: link.quoteId!, tenantId },
        select: {
          id: true,
          quoteNumber: true,
          customerId: true,
          notes: true,
          lines: { orderBy: { position: 'asc' }, select: { description: true, priceCode: true } },
        },
      });

      const task = await tx.task.create({
        data: {
          tenantId,
          customerId: quote.customerId,
          title: `הצעת מחיר מס' ${quote.quoteNumber} — אושרה`,
          description: quote.notes ?? null,
          source: TaskSource.QUOTE,
          status: TaskStatus.NEW,
          // הצ'קליסט הוא השורות שהלקוח אישר. done=false: הטכנאי מסמן מה בוצע,
          // והחשבונית מחייבת רק שורות שסומנו.
          checklist: quote.lines.map((l) => ({ label: l.description, done: false, priceCode: l.priceCode })),
        },
        select: { id: true },
      });
      await tx.quote.update({ where: { id: quote.id }, data: { taskId: task.id } });
      await this.audit(tx, tenantId, null, 'quote.approved', quote.id, { via: 'public_link', taskId: task.id });
      await tx.outboxEvent.create({
        data: { tenantId, eventName: 'task.created', payload: { tenantId, taskId: task.id, source: 'QUOTE' } },
      });
    });
    return this.publicView(token);
  }

  async decline(token: string) {
    const { tenantId, link } = await this.links.resolve(token, PublicLinkPurpose.QUOTE);
    await this.prisma.forTenant(tenantId, async (tx) => {
      // כמו ב-approve: הצעה שפג תוקפה סגורה לשני הכיוונים. הדף כבר מציג
      // canRespond:false, והשרת לא אמור לקבל מה שהדף לא מציע (QA 18.09, F12).
      const now = new Date();
      const { count } = await tx.quote.updateMany({
        where: { id: link.quoteId!, tenantId, status: QuoteStatus.SENT, validUntil: { gt: now } },
        data: { status: QuoteStatus.DECLINED, declinedAt: now },
      });
      if (count === 0) throw new ConflictException('This quote can no longer be declined');
      await this.audit(tx, tenantId, null, 'quote.declined', link.quoteId!, { via: 'public_link' });
    });
    return this.publicView(token);
  }

  private audit(tx: Tx, tenantId: string, userId: string | null, action: string, entityId: string, metadata: object) {
    return tx.auditLog.create({
      data: { tenantId, userId, action, entityType: 'Quote', entityId, metadata },
    });
  }
}

/** לתצוגה בהודעה בלבד. הסכום עצמו נשאר Decimal. */
function formatIls(amount: Prisma.Decimal): string {
  return `${new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
    Number(amount.toFixed(2)),
  )} ₪`;
}
