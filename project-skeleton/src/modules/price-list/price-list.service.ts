import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

import { CreatePriceListItemDto } from './dto/create-price-list-item.dto';
import { ListPriceListQueryDto } from './dto/list-price-list.query.dto';
import { UpdatePriceListItemDto } from './dto/update-price-list-item.dto';

type LockedRow = { description: string; price: Prisma.Decimal; isActive: boolean; code: string };

/**
 * המחירון.
 *
 * עד עכשיו הוא נכתב פעם אחת, באונבורדינג, ואז קפא. בעל עסק שהעלה
 * מחיר לא יכול היה לעדכן אותו, וכל חשבונית יצאה במחיר הישן.
 *
 * עריכה כאן אינה משנה חשבוניות שכבר הופקו: שורת חשבונית שומרת עותק
 * של הסכום והתיאור ברגע ההפקה, ולא מצביעה על הפריט.
 */
@Injectable()
export class PriceListService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, query: ListPriceListQueryDto) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const items = await tx.priceListItem.findMany({
        where: { tenantId, ...(query.includeInactive ? {} : { isActive: true }) },
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      });

      const usage = await this.templateUsage(tx, tenantId);
      return items.map((item) => ({ ...item, usedByTemplates: usage.get(item.code) ?? 0 }));
    });
  }

  async create(tenantId: string, data: CreatePriceListItemDto, actorUserId?: string) {
    return this.prisma.forTenant(tenantId, async (tx) => {
      try {
        const item = await tx.priceListItem.create({
          data: {
            tenantId,
            code: data.code,
            description: data.description,
            price: new Prisma.Decimal(data.price),
          },
        });

        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorUserId ?? null,
            action: 'price_list_item.created',
            entityType: 'PriceListItem',
            entityId: item.id,
            metadata: { code: item.code, price: item.price.toString() },
          },
        });

        return { ...item, usedByTemplates: 0 };
      } catch (err) {
        // `@@unique([tenantId, code])` ולא בדיקה מקדימה — שתי בקשות
        // מקבילות היו עוברות את הבדיקה שתיהן (קונבנציות, סעיף 6).
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException(`Price code "${data.code}" already exists`);
        }
        throw err;
      }
    });
  }

  async update(tenantId: string, id: string, data: UpdatePriceListItemDto, actorUserId?: string) {
    if (data.description === undefined && data.price === undefined && data.isActive === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    return this.prisma.forTenant(tenantId, async (tx) => {
      // FOR UPDATE: בלי נעילה, שני עדכונים מקבילים היו רושמים ביומן
      // את אותו מחיר "לפני", ויומן הביקורת היה מספר סיפור שלא קרה.
      const [before] = await tx.$queryRaw<LockedRow[]>`
        SELECT code, description, price, "isActive"
        FROM price_list_items
        WHERE id = ${id}::uuid AND "tenantId" = ${tenantId}::uuid
        FOR UPDATE
      `;
      if (!before) throw new NotFoundException('Price list item not found');

      const item = await tx.priceListItem.update({
        where: { id },
        data: {
          ...(data.description !== undefined && { description: data.description }),
          ...(data.price !== undefined && { price: new Prisma.Decimal(data.price) }),
          ...(data.isActive !== undefined && { isActive: data.isActive }),
        },
      });

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (data.description !== undefined && data.description !== before.description) {
        changes.description = { from: before.description, to: item.description };
      }
      if (data.price !== undefined && !new Prisma.Decimal(before.price).equals(item.price)) {
        changes.price = { from: new Prisma.Decimal(before.price).toString(), to: item.price.toString() };
      }
      if (data.isActive !== undefined && data.isActive !== before.isActive) {
        changes.isActive = { from: before.isActive, to: item.isActive };
      }

      if (Object.keys(changes).length > 0) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorUserId ?? null,
            action: 'price_list_item.updated',
            entityType: 'PriceListItem',
            entityId: item.id,
            metadata: { code: item.code, changes } as Prisma.InputJsonValue,
          },
        });
      }

      const usage = await this.templateUsage(tx, tenantId, item.code);
      return { ...item, usedByTemplates: usage.get(item.code) ?? 0 };
    });
  }

  /**
   * כמה תבניות פעילות מפנות לכל קוד.
   *
   * זה המידע שמונע טעות שקטה: השבתת קוד שתבנית עדיין משתמשת בו
   * לא נכשלת — החשבונית פשוט מדלגת על השורה. הממשק מציג את המספר
   * כדי שההשבתה תהיה החלטה מודעת.
   */
  private async templateUsage(
    tx: Prisma.TransactionClient,
    tenantId: string,
    onlyCode?: string,
  ): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<Array<{ code: string; count: bigint }>>`
      SELECT item->>'priceCode' AS code, COUNT(DISTINCT t.id) AS count
      FROM job_type_templates t
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(t."defaultChecklist") = 'array' THEN t."defaultChecklist" ELSE '[]'::jsonb END
      ) AS item
      WHERE t."tenantId" = ${tenantId}::uuid
        AND t."isActive" = true
        AND item->>'priceCode' IS NOT NULL
        ${onlyCode === undefined ? Prisma.empty : Prisma.sql`AND item->>'priceCode' = ${onlyCode}`}
      GROUP BY item->>'priceCode'
    `;
    return new Map(rows.map((r) => [r.code, Number(r.count)]));
  }
}
