import { z } from 'zod';

/**
 * אימות משתני סביבה בזמן עלייה.
 *
 * הגרסה הקודמת השתמשה ב-`config.get('JWT_SECRET', 'dev-only-insecure-secret-change-me')`.
 * `ConfigService.get(key, default)` מחזיר את ברירת המחדל גם כשהמשתנה
 * *ריק*, כך שקונטיינר פרודקשן שעלה בלי המשתנה חתם טוקנים בסוד שנמצא
 * בעץ המקור — וכל אחד יכול היה לזייף OWNER לכל טננט.
 *
 * הכלל כאן: אין ברירות מחדל לסודות. חסר משתנה = האפליקציה לא עולה,
 * עם הודעה שאומרת בדיוק מה חסר.
 *
 * ראו docs/10-audit-findings.md#I1.
 */

const csv = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const secret = (min: number, label: string) =>
  z
    .string()
    .min(min, `${label} must be at least ${min} characters`)
    .refine((v) => !/^(replace|change|dev-only|test|secret|password)/i.test(v), {
      message: `${label} still looks like a placeholder — generate a real value`,
    });

/** placeholder נראה מוגדר ונכשל רק בקריאה הראשונה. */
const isRealSecret = (v: string): boolean =>
  v.trim() !== '' && !/placeholder|replace_with|your[-_]|changeme/i.test(v);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    BASE_DOMAIN: z.string().min(1),
    CORS_ORIGINS: z.string().default('').transform(csv),

    // הכתובת שבה הלקוח פותח קישור ציבורי (/c/...). נכנסת להודעות WhatsApp.
    PUBLIC_APP_URL: z.string().url().default('https://craftmind-ai.com'),

    // --- Database ---
    // DATABASE_URL חייב להיות תפקיד ה-app. אם מישהו מדביק כאן בטעות
    // את ה-migrator, ה-RLS מושבת לחלוטין — ובלי הבדיקה הזו, בשקט.
    DATABASE_URL: z
      .string()
      .url()
      .refine((v) => !v.includes('craftmind_migrator'), {
        message:
          'DATABASE_URL must use the craftmind_app role, never craftmind_migrator. ' +
          'The migrator owns the tables and would bypass RLS entirely.',
      }),
    DIRECT_DATABASE_URL: z.string().url(),
    SHADOW_DATABASE_URL: z.string().url().optional(),

    REDIS_URL: z.string().url(),

    /**
     * יעד להתראות תפעוליות. Slack/Discord או כל endpoint שמקבל POST
     * של JSON. ריק = ההתראות נרשמות ברמת error בלבד.
     */
    ALERT_WEBHOOK_URL: z.string().default(''),

    // --- Secrets ---
    JWT_SECRET: secret(32, 'JWT_SECRET'),
    JWT_EXPIRES_IN: z.string().default('12h'),

    // סוד נפרד במכוון. כששניהם זהים, טוקן ה-state של OAuth — שנוסע
    // ב-query string דרך השרתים של Google — הוא טוקן גישה תקף.
    OAUTH_STATE_SECRET: secret(32, 'OAUTH_STATE_SECRET'),

    INTEGRATION_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'INTEGRATION_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)'),
    INTEGRATION_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),

    // --- Google ---
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REDIRECT_URI: z.string().default(''),

    // --- LLM ---
    // 'auto' בוחר את הספק שמוגדר בפועל. ראו src/llm/llm.module.ts.
    LLM_PROVIDER: z.enum(['auto', 'anthropic', 'gemini']).default('auto'),

    ANTHROPIC_API_KEY: z.string().default(''),
    ANTHROPIC_EXTRACTION_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    ANTHROPIC_ONBOARDING_MODEL: z.string().default('claude-sonnet-5'),

    // Gemini — יש לו מכסה חינמית, ולכן הוא חלופה טובה לפיתוח.
    GEMINI_API_KEY: z.string().default(''),
    GEMINI_MODEL: z.string().default('gemini-3.7-flash'),

    LLM_DEFAULT_MONTHLY_BUDGET_MINOR: z.coerce.number().int().nonnegative().default(50_000),
    LLM_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(40_000),
    ONBOARDING_MAX_LLM_CALLS_PER_SESSION: z.coerce.number().int().positive().default(60),
    ONBOARDING_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === env.OAUTH_STATE_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OAUTH_STATE_SECRET'],
        message:
          'OAUTH_STATE_SECRET must differ from JWT_SECRET. Sharing them makes a leaked OAuth ' +
          'state token a valid access token. See docs/10-audit-findings.md#C6.',
      });
    }

    if (env.NODE_ENV === 'production') {
      // ספק LLM אחד לפחות. הדרישה היא על *יכולת*, לא על ספק מסוים —
      // אחרת מעבר ל-Gemini היה נחסם על ידי בדיקה של Anthropic.
      const hasLlm =
        (env.LLM_PROVIDER !== 'gemini' && isRealSecret(env.ANTHROPIC_API_KEY)) ||
        (env.LLM_PROVIDER !== 'anthropic' && isRealSecret(env.GEMINI_API_KEY));
      if (!hasLlm) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['LLM_PROVIDER'],
          message:
            'No usable LLM key. Set ANTHROPIC_API_KEY or GEMINI_API_KEY (and LLM_PROVIDER if you want to pin one).',
        });
      }

      if (env.CORS_ORIGINS.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS must be set explicitly in production.',
        });
      }
      // Google הוא קבוצה אחת: או שלושתם, או אף אחד. אף אחד = חיבור
      // Gmail/Drive כבוי, והשרת עולה — אחרת כל פריסה נחסמת עד שיש
      // אפליקציית OAuth מאושרת. חלקי או placeholder = שגיאה, כי הוא
      // נראה מוגדר ונכשל רק בקריאה הראשונה, עמוק בתוך זרימת משתמש.
      const google = {
        GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
        GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
      };
      const anyGoogle = Object.values(google).some((v) => v !== '');
      if (anyGoogle) {
        for (const [key, value] of Object.entries(google)) {
          if (!value || /placeholder|replace_with|your[-_]/i.test(value)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} is missing or a placeholder. Set all three GOOGLE_* variables, or none to disable Google.`,
            });
          }
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/**
 * נקרא מ-ConfigModule.forRoot({ validate }). זורק לפני שכל מודול אחר
 * נטען, כך שהכשל מגיע לפני שנפתח חיבור DB או שמאזינים לפורט.
 */
export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\n` +
        `See .env.example for the full list of required variables.`,
    );
  }

  return result.data;
}
