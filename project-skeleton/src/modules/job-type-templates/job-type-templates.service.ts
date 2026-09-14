import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { JobTypeTemplate } from '@prisma/client';

import { PrismaService, type TenantClient } from '../../database/prisma.service';

// ראו מסמך הארכיטקטורה סעיף 4.3 - זו הישות שמזינה את הטופס הידני
@Injectable()
export class JobTypeTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * נרמול הסקיל. `JobTypeTemplate.requiredSkill` מושווה ל-User.skills[]
   * בשוויון מחרוזות מדויק, אז "חשמל " ו-"חשמל" הם שני סקילים שונים
   * מבחינת ה-DB — והתוצאה היא משימה שלא משובצת לאיש, בלי שגיאה.
   * הנרמול נעשה בכתיבה ולא בקריאה, כדי שגם האינדקס יתאים.
   */
  static normalizeSkill(skill: string | null | undefined): string | null {
    const normalized = skill?.trim().toLowerCase();
    return normalized ? normalized : null;
  }

  findAllActive(tenantId: string): Promise<JobTypeTemplate[]> {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.jobTypeTemplate.findMany({
        where: { tenantId, isActive: true },
        orderBy: { name: 'asc' },
      }),
    );
  }

  findOne(tenantId: string, id: string): Promise<JobTypeTemplate | null> {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.jobTypeTemplate.findFirst({ where: { id, tenantId } }),
    );
  }

  create(
    tenantId: string,
    data: {
      name: string;
      requiredSkill?: string | null;
      fields: unknown[]; // { key, label, type, required, options? }[]
      defaultChecklist: unknown[]; // { label, priceCode?, sku?, qty? }[]
      defaultPriority?: number;
    },
    actorUserId?: string,
  ): Promise<JobTypeTemplate> {
    return this.prisma.forTenant(tenantId, async (tx) => {
      const template = await tx.jobTypeTemplate.create({
        data: {
          tenantId,
          name: data.name.trim(),
          requiredSkill: JobTypeTemplatesService.normalizeSkill(data.requiredSkill),
          fields: data.fields as Prisma.InputJsonValue,
          defaultChecklist: data.defaultChecklist as Prisma.InputJsonValue,
          ...(data.defaultPriority !== undefined ? { defaultPriority: data.defaultPriority } : {}),
        },
      });

      await this.writeAudit(tx, {
        tenantId,
        userId: actorUserId,
        action: 'job_type_template.created',
        entityId: template.id,
        metadata: { name: template.name, requiredSkill: template.requiredSkill },
      });

      return template;
    });
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
        entityType: 'JobTypeTemplate',
        entityId: entry.entityId,
        metadata: (entry.metadata ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
  }
}
