// ============================================================
// Connector Interface (מסמך הארכיטקטורה, סעיף 3.1)
// כל ספק חיצוני (Gmail, Drive, ובעתיד Outlook/חשבונית ירוקה) מממש
// את אותו ה-interface. שאר האפליקציה (Intake, Comms, Invoicing
// modules) קוראת ל-IntegrationsService.getConnector(tenantId, provider)
// ולא יודעת/צריכה לדעת איזה ספק ספציפי מאחורי זה.
//
// הוספת ספק חדש = מימוש אחד של ה-interface הזה + רישום ב-registry
// (IntegrationsService) - לא שינוי בשום מודול קיים אחר.
// ============================================================

export interface Connector {
  readonly provider: string;

  // מוודא שיש טוקן תקף (מרענן access token עם refresh token אם פג תוקף).
  // נקרא לפני כל fetch/send - לא נקרא ישירות מבחוץ בדרך כלל.
  ensureAuthenticated(): Promise<void>;

  // resource הוא string חופשי לפי הקונקטור (לדוגמה Gmail: "unread_messages")
  fetch<T = unknown>(resource: string, filter?: Record<string, unknown>): Promise<T>;

  // resource לדוגמה Gmail: "message" (שליחת מייל), Drive: "file" (העלאה)
  send<T = unknown>(resource: string, payload: unknown): Promise<T>;

  // רישום ל-push notifications אם הספק תומך (Gmail API watch).
  // מחזיר מזהה subscription לצורך ניהול/ביטול בהמשך. אופציונלי -
  // קונקטורים שלא תומכים (כמו Drive ב-MVP) יכולים להחזיר null.
  subscribe?(event: string): Promise<string | null>;
}

export interface OAuthConnector extends Connector {
  getAuthUrl(state: string): string;
  handleCallback(
    code: string,
  ): Promise<{ accessToken: string; refreshToken: string; scopes: string[] }>;
}
