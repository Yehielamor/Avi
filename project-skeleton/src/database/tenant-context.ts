import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * נושא את זהות הטננט של הבקשה הנוכחית לאורך שרשרת ה-async, בלי
 * להעביר `tenantId` דרך כל חתימת פונקציה.
 *
 * זו *נוחות*, לא גבול אבטחה. הגבול האמיתי הוא ה-RLS ב-Postgres,
 * שנאכף בתוך הטרנזקציה ב-PrismaService.forTenant().
 */

export interface RequestContext {
  tenantId: string;
  userId?: string;
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const TenantContext = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return storage.run(ctx, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  /** מחזירה את הקונטקסט או זורקת. לשימוש בקוד שחייב טננט. */
  require(): RequestContext {
    const ctx = storage.getStore();
    if (!ctx) {
      throw new Error(
        'No tenant context in scope. Code that touches tenant data must run inside ' +
          'TenantContext.run() — normally established by TenantContextMiddleware.',
      );
    }
    return ctx;
  },
};
