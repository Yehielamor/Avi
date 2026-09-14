import type { LlmToolDefinition } from '../../llm/llm.types';

// ============================================================
// הגדרות ה-tools שה-LLM יכול לקרוא במהלך שיחת ה-onboarding.
// עיקרון מרכזי: ה-LLM אף פעם לא כותב ל-DB ישירות - הוא רק "מסמן"
// עובדה מובנית (tool call), וקוד דטרמיניסטי (onboarding.service.ts)
// הוא שמעדכן את ה-DB בפועל. זה מפריד בין "הבנה" (LLM) ל"ביצוע" (קוד).
// ============================================================

export const ONBOARDING_TOOLS: LlmToolDefinition[] = [
  {
    name: 'record_company_info',
    description:
      'שמור את פרטי החברה הבסיסיים ברגע שנאספו כולם בשיחה (שם, ח.פ, סוג העסק, מייל ליצירת קשר). אפשר לקרוא שוב אם פרט מתעדכן.',
    parameters: {
      type: 'object',
      properties: {
        legalName: { type: 'string', description: 'שם החברה הרשמי' },
        businessId: { type: 'string', description: 'מספר ח.פ או עוסק מורשה' },
        vertical: {
          type: 'string',
          enum: ['MAINTENANCE', 'CARPENTRY', 'RETAIL'],
          description: 'MAINTENANCE=חברת אחזקה, CARPENTRY=נגרייה, RETAIL=חנות קמעונאית',
        },
        contactEmail: { type: 'string' },
      },
      required: ['legalName', 'businessId', 'vertical', 'contactEmail'],
    },
  },
  {
    name: 'add_team_member',
    description: 'הוסף איש צוות אחד שהוזכר בשיחה. קרא פעם אחת לכל איש צוות (לא כל השיחה מחדש).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        role: {
          type: 'string',
          enum: ['OWNER', 'MANAGER', 'FIELD'],
          description: 'OWNER=בעל העסק, MANAGER=מנהל/פקיד, FIELD=איש צוות שטח',
        },
      },
      required: ['name', 'email', 'role'],
    },
  },
  {
    name: 'add_price_code',
    description:
      'הוסף קוד מחירון/"קוד סגירה" אחד שהוזכר בשיחה - למשל פעולה שהעסק מתמחר בנפרד. קרא פעם אחת לכל קוד.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'קוד קצר ללא רווחים, למשל AC-FILTER-REPLACE' },
        description: { type: 'string' },
        defaultPrice: { type: 'number' },
      },
      required: ['code', 'description', 'defaultPrice'],
    },
  },
  {
    name: 'add_job_type',
    description:
      'הוסף סוג עבודה (תבנית) אחד שהוגדר בשיחה - למשל "התקנת מזגן" או "ארון הזמנה". קרא פעם אחת לכל סוג עבודה, אחרי שדנתם באילו שדות/פעולות הוא כולל.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        requiredSkill: {
          type: 'string',
          description: 'אופציונלי - התמחות נדרשת מטכנאי, לשיוך אוטומטי',
        },
        fields: {
          type: 'array',
          description: 'שדות שהטופס הידני יציג בפתיחת עבודה מהסוג הזה',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: ['text', 'number', 'select', 'date'] },
              required: { type: 'boolean' },
            },
            required: ['key', 'label', 'type'],
          },
        },
        defaultChecklist: {
          type: 'array',
          description:
            'הפעולות שצריך לסמן כדי לסגור עבודה מהסוג הזה, כל אחת עם קוד מחירון אם רלוונטי',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, priceCode: { type: 'string' } },
            required: ['label'],
          },
        },
      },
      required: ['name', 'fields', 'defaultChecklist'],
    },
  },
  {
    name: 'ready_to_finalize',
    description:
      'קרא לפונקציה הזו רק אחרי שנאספו: פרטי חברה מלאים, לפחות איש צוות אחד (בעל העסק לפחות), ולפחות סוג עבודה אחד עם checklist. אל תקרא לזה מוקדם מדי.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'סיכום קצר בעברית של מה שנאסף, להצגה למשתמש לפני אישור סופי',
        },
      },
      required: ['summary'],
    },
  },
];
