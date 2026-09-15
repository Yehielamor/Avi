import type { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../src/database/prisma.service';
import { LlmUsageService } from '../../src/llm/llm-usage.service';
import { MeteredLlmProvider } from '../../src/llm/metered-llm.provider';
import { estimateCostMinor } from '../../src/llm/llm-pricing';
import type { LlmProvider, LlmRequest, LlmResponse } from '../../src/llm/llm.types';

/**
 * מדידת LLM ואכיפת תקציב.
 *
 * טבלת `LlmUsage` ותקרת `llmMonthlyBudgetMinor` היו בסכימה מההתחלה
 * ואיש לא כתב אליהן או קרא מהן — כלומר לא הייתה תשובה ל"כמה הטננט
 * הזה עולה", והתקרה לא הגבילה דבר.
 *
 * הספק כאן מדומה במכוון: הנבדק הוא **המדידה**, ולא הספק. שימוש
 * בספק אמיתי היה הופך את הבדיקה לאיטית, יקרה ותלויה במכסה חיצונית.
 */
describe('LLM metering', () => {
  const TENANT = '77777777-7777-7777-7777-777777777777';

  let prisma: PrismaService;
  let usage: LlmUsageService;
  let calls = 0;

  const fake: LlmProvider = {
    name: 'fake',
    model: 'gemini-3.6-flash',
    isConfigured: true,
    complete: (): Promise<LlmResponse> => {
      calls += 1;
      return Promise.resolve({
        text: 'ok',
        toolCalls: [],
        stopReason: 'end',
        usage: { inputTokens: 12_000, outputTokens: 3_000 },
        model: 'gemini-3.6-flash',
      });
    },
    continueWithToolResults: () => Promise.reject(new Error('unused')),
  };

  const req: LlmRequest = {
    messages: [{ role: 'user', content: 'x' }],
    purpose: 'test.metering',
    tenantId: TENANT,
  };

  let metered: MeteredLlmProvider;

  beforeAll(async () => {
    prisma = PrismaService.create();
    await prisma.$connect();
    usage = new LlmUsageService(prisma, {
      get: () => 50_000,
    } as unknown as ConfigService<never, true>);
    metered = new MeteredLlmProvider(fake, usage);

    await cleanup();
    await prisma.forTenant(TENANT, (tx) =>
      tx.tenant.create({
        data: {
          id: TENANT,
          name: 'Metering',
          vertical: 'MAINTENANCE',
          subdomain: 'metering-test',
          config: {
            create: { enabledModules: [], theme: {}, emailTemplates: {} },
          },
        },
      }),
    );
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function cleanup(): Promise<void> {
    try {
      await prisma.forTenant(TENANT, async (tx) => {
        await tx.llmUsage.deleteMany({ where: { tenantId: TENANT } });
        await tx.tenantConfig.deleteMany({ where: { tenantId: TENANT } });
        await tx.tenant.deleteMany({ where: { id: TENANT } });
      });
    } catch {
      /* לא קיים עדיין */
    }
  }

  beforeEach(async () => {
    calls = 0;
    await prisma.forTenant(TENANT, async (tx) => {
      await tx.llmUsage.deleteMany({ where: { tenantId: TENANT } });
      await tx.tenantConfig.updateMany({
        where: { tenantId: TENANT },
        data: { llmMonthlyBudgetMinor: null },
      });
    });
  });

  it('records a row for every call', async () => {
    await metered.complete(req);

    const rows = await prisma.forTenant(TENANT, (tx) =>
      tx.llmUsage.findMany({ where: { tenantId: TENANT } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inputTokens).toBe(12_000);
    expect(rows[0]!.outputTokens).toBe(3_000);
    expect(rows[0]!.purpose).toBe('test.metering');
  });

  it('prices the call from the model, not a flat rate', async () => {
    await metered.complete(req);
    const [row] = await prisma.forTenant(TENANT, (tx) =>
      tx.llmUsage.findMany({ where: { tenantId: TENANT } }),
    );
    expect(row!.estimatedCostMinor).toBe(
      estimateCostMinor('gemini-3.6-flash', { inputTokens: 12_000, outputTokens: 3_000 }),
    );
    expect(row!.estimatedCostMinor).toBeGreaterThan(0);
  });

  it('accumulates spend across calls', async () => {
    await metered.complete(req);
    await metered.complete(req);

    const { spentMinor } = await usage.monthToDate(TENANT);
    const one = estimateCostMinor('gemini-3.6-flash', { inputTokens: 12_000, outputTokens: 3_000 });
    expect(spentMinor).toBe(one * 2);
  });

  it('skips recording when there is no tenant', async () => {
    // onboarding רץ לפני שהטננט קיים. השליטה שם היא תקרת קריאות
    // לסשן, לא תקציב — ולכן אין לאן לשייך.
    await metered.complete({ ...req, tenantId: undefined });

    const rows = await prisma.forTenant(TENANT, (tx) =>
      tx.llmUsage.findMany({ where: { tenantId: TENANT } }),
    );
    expect(rows).toHaveLength(0);
  });

  describe('budget enforcement', () => {
    it('blocks the call once the budget is reached', async () => {
      await metered.complete(req);
      await prisma.forTenant(TENANT, (tx) =>
        tx.tenantConfig.updateMany({
          where: { tenantId: TENANT },
          data: { llmMonthlyBudgetMinor: 1 },
        }),
      );

      const before = calls;
      await expect(metered.complete(req)).rejects.toThrow(/budget/i);
      // הבדיקה חייבת לקרות *לפני* הקריאה. בדיקה אחרי הייתה מאפשרת
      // לחרוג בכל פעם ורק אז להתריע.
      expect(calls).toBe(before);
    });

    it('allows the call while under budget', async () => {
      await prisma.forTenant(TENANT, (tx) =>
        tx.tenantConfig.updateMany({
          where: { tenantId: TENANT },
          data: { llmMonthlyBudgetMinor: 1_000_000 },
        }),
      );
      await expect(metered.complete(req)).resolves.toBeDefined();
    });

    it('falls back to the global default when the tenant has none', async () => {
      const { budgetMinor } = await usage.monthToDate(TENANT);
      expect(budgetMinor).toBe(50_000);
    });
  });
});
