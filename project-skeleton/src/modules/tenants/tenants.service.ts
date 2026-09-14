import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, Vertical } from '@prisma/client';
import type { Tenant, TenantConfig } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export interface CreateTenantInput {
  name: string;
  vertical: Vertical;
  /** ייחודי גלובלית. המתקשר אחראי לייצר אותו (ראו slugify.util ב-onboarding). */
  subdomain: string;
  /** null = ברירת המחדל לפי vertical. */
  enabledModules?: string[] | null;
  theme?: Record<string, unknown>;
  emailTemplates?: Record<string, unknown>;
  llmMonthlyBudgetMinor?: number | null;
}

export type TenantWithConfig = Tenant & { config: TenantConfig | null };

/**
 * מודלים ברירת מחדל לפי ורטיקל. ראו docs/db-schema.md.
 */
const MODULES_BY_VERTICAL: Record<Vertical, string[]> = {
  MAINTENANCE: ['intake', 'tasks', 'scheduling', 'inventory', 'invoicing', 'comms'],
  CARPENTRY: ['intake', 'tasks', 'scheduling', 'invoicing', 'comms'],
  RETAIL: ['intake', 'tasks', 'inventory', 'invoicing', 'comms'],
};

const DEFAULT_THEME = { primaryColor: '#2563eb', logoUrl: null };

const DEFAULT_EMAIL_TEMPLATES = {
  taskCreated: 'שלום {customerName}, קיבלנו את פנייתך ונחזור אליך בהקדם.',
  taskClosed: 'שלום {customerName}, הטיפול בפנייתך הושלם. פירוט: {checklistSummary}',
};

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * תת-דומיין -> טננט.
   *
   * התרגום עצמו עובר דרך `resolve_tenant_by_subdomain` (SECURITY
   * DEFINER, עמודה אחת) — זו הדרך היחידה לשבור את ביצת-התרנגולת של
   * ה-RLS. אחריו הטעינה המלאה כבר רצה בתוך קונטקסט הטננט.
   */
  async findBySubdomain(subdomain: string): Promise<TenantWithConfig | null> {
    const tenantId = await this.prisma.resolveTenantBySubdomain(subdomain.trim().toLowerCase());
    if (!tenantId) return null;

    return this.prisma.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, include: { config: true } }),
    );
  }

  findById(tenantId: string): Promise<TenantWithConfig | null> {
    return this.prisma.forTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, include: { config: true } }),
    );
  }

  /**
   * יצירת טננט + TenantConfig ברירת מחדל. זו המימוש היחיד.
   *
   * ה-id נוצר בקוד ולא ב-DB בכוונה: ה-policy על `tenants` היא
   * `id = current_tenant_id()`, כלומר צריך לדעת את המזהה *לפני*
   * ה-INSERT כדי לקבוע אותו כקונטקסט. זה מה שמאפשר ליצור טננט
   * בלי שום עקיפת RLS.
   *
   * NOTE ל-onboarding (onboarding-finalize.service.ts, בבעלות סוכן
   * אחר): המימוש שם ב-`tx.tenant.create` הוא שכפול של הפונקציה הזו
   * ורץ מחוץ ל-forTenant. הוא צריך לקרוא ל-createTenant() הזו ואז
   * להמשיך את יצירת המשתמשים/מחירון בתוך forTenant(tenant.id, ...).
   */
  async createTenant(input: CreateTenantInput): Promise<TenantWithConfig> {
    const tenantId = randomUUID();
    const subdomain = input.subdomain.trim().toLowerCase();
    const enabledModules = input.enabledModules ?? this.defaultModulesForVertical(input.vertical);

    const tenant = await this.prisma.forTenant(tenantId, async (tx) => {
      const created = await tx.tenant.create({
        data: {
          id: tenantId,
          name: input.name.trim(),
          vertical: input.vertical,
          subdomain,
          config: {
            create: {
              enabledModules: enabledModules,
              theme: (input.theme ?? DEFAULT_THEME) as Prisma.InputJsonValue,
              emailTemplates: (input.emailTemplates ??
                DEFAULT_EMAIL_TEMPLATES) as Prisma.InputJsonValue,
              schedulingWeights: enabledModules.includes('scheduling')
                ? {
                    skillWeight: 0.5,
                    distanceWeight: 0.3,
                    loadWeight: 0.2,
                  }
                : Prisma.DbNull,
              llmMonthlyBudgetMinor: input.llmMonthlyBudgetMinor ?? null,
            },
          },
        },
        include: { config: true },
      });

      await tx.auditLog.create({
        data: {
          tenantId,
          action: 'tenant.created',
          entityType: 'Tenant',
          entityId: tenantId,
          metadata: { subdomain, vertical: input.vertical, enabledModules },
        },
      });

      return created;
    });

    this.logger.log({ tenantId, subdomain }, 'Tenant created');
    return tenant;
  }

  defaultModulesForVertical(vertical: Vertical): string[] {
    return [...(MODULES_BY_VERTICAL[vertical] ?? MODULES_BY_VERTICAL.MAINTENANCE)];
  }
}
