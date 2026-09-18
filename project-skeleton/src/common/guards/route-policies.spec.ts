import * as fs from 'node:fs';
import * as path from 'node:path';

import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ANY_ROLE_KEY, ROLES_KEY } from '../decorators/roles.decorator';

/**
 * לכל נתיב יש מדיניות גישה מפורשת.
 *
 * RolesGuard נכשל סגור, ולכן נתיב שנשכח מחזיר 403 ולא פרצה. אבל 403
 * כזה מתגלה רק כשמישהו לוחץ על הכפתור בפרודקשן. הבדיקה הזו מוצאת אותו
 * בזמן בדיקות.
 *
 * היא מחליפה את scripts/scan-route-policies.mjs, שדרש שרת רץ וסיסמה
 * של משתמש אמיתי ולכן כמעט לא הורץ. היא קוראת את אותו metadata שה-
 * guard קורא, ולא מחפשת טקסט של דקורטורים — grep כבר נתן כאן פעמיים
 * "הכל תקין" כוזב.
 */
const SRC = path.resolve(__dirname, '../..');

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

type Route = { route: string; hasPolicy: boolean };

function routesOf(file: string): Route[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(file) as Record<string, unknown>;
  return Object.values(mod)
    .filter((v): v is new (...args: never[]) => unknown => typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v))
    .flatMap((controller) => {
      const classPolicy = [ROLES_KEY, ANY_ROLE_KEY, IS_PUBLIC_KEY].some((k) => Reflect.hasMetadata(k, controller));
      const proto = controller.prototype as Record<string, unknown>;
      return Object.getOwnPropertyNames(proto)
        .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
        .map((name) => proto[name] as object)
        .filter((handler) => Reflect.hasMetadata(METHOD_METADATA, handler))
        .map((handler) => ({
          route: `${controller.name}.${(handler as { name: string }).name}`,
          hasPolicy:
            classPolicy || [ROLES_KEY, ANY_ROLE_KEY, IS_PUBLIC_KEY].some((k) => Reflect.hasMetadata(k, handler)),
        }));
    });
}

describe('route access policies', () => {
  const files = controllerFiles(SRC);
  const routes = files.flatMap(routesOf);

  it('actually finds the controllers and their routes', () => {
    // בלי זה, glob שבור או שינוי במבנה התיקיות היו נותנים "0 נתיבים
    // ללא מדיניות" — עובר, ולא בודק דבר.
    expect(files.length).toBeGreaterThanOrEqual(13);
    expect(routes.length).toBeGreaterThanOrEqual(35);
    expect(routes.map((r) => r.route)).toContain('PriceListController.update');
  });

  it('gives every route an explicit @Roles, @AnyRole or @Public', () => {
    expect(routes.filter((r) => !r.hasPolicy).map((r) => r.route)).toEqual([]);
  });
});
