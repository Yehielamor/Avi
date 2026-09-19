import type { IncomingMessage } from 'node:http';

import { json } from 'express';

/** נתיבים שהגוף שלהם חתום, ולכן צריך את הבייטים המדויקים ולא את ה-JSON המפוענח. */
const RAW_BODY_PATHS = ['/v1/intake/inbound'];

/**
 * json parser עם תקרת גודל, ששומר `req.rawBody` רק בנתיבים חתומים.
 * משותף ל-main.ts ולבדיקות — כדי שהבדיקה תריץ בדיוק את מה שרץ בפרודקשן.
 */
export function jsonBody(limit = '1mb') {
  return json({
    limit,
    verify: (req: IncomingMessage & { rawBody?: Buffer }, _res, buf) => {
      if (RAW_BODY_PATHS.some((p) => req.url?.startsWith(p))) req.rawBody = buf;
    },
  });
}
