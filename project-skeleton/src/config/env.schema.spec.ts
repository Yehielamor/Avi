import { validateEnv } from './env.schema';

/**
 * שער הסביבה.
 *
 * כל כלל כאן חוסם תקלה שאחרת הייתה שקטה: RLS כבוי בגלל URL שגוי, טוקן
 * OAuth שהופך לטוקן גישה, placeholder שנראה מוגדר ונכשל רק מול משתמש.
 * שבירת כלל כזה לא מפילה אף בדיקה אחרת — ולכן הוא נבדק כאן ישירות.
 */
const production = (overrides: Record<string, string> = {}): Record<string, string> => ({
  NODE_ENV: 'production',
  BASE_DOMAIN: 'example.com',
  CORS_ORIGINS: 'https://app.example.com',
  DATABASE_URL: 'postgresql://craftmind_app:pw@postgres:5432/craftmind',
  DIRECT_DATABASE_URL: 'postgresql://craftmind_migrator:pw@postgres:5432/craftmind',
  REDIS_URL: 'redis://redis:6379',
  JWT_SECRET: 'j'.repeat(64),
  OAUTH_STATE_SECRET: 'o'.repeat(64),
  INTEGRATION_ENCRYPTION_KEY: 'a'.repeat(64),
  LLM_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'real-looking-key',
  ...overrides,
});

const issuesFor = (env: Record<string, string>): string => {
  try {
    validateEnv(env);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
};

describe('validateEnv', () => {
  it('accepts a complete production config', () => {
    expect(issuesFor(production())).toBe('');
  });

  it('refuses a DATABASE_URL that uses the table owner, which bypasses RLS', () => {
    expect(
      issuesFor(production({ DATABASE_URL: 'postgresql://craftmind_migrator:pw@postgres:5432/craftmind' })),
    ).toMatch(/DATABASE_URL must use the craftmind_app role/);
  });

  it('refuses sharing JWT_SECRET with OAUTH_STATE_SECRET', () => {
    const same = 's'.repeat(64);
    expect(issuesFor(production({ JWT_SECRET: same, OAUTH_STATE_SECRET: same }))).toMatch(
      /OAUTH_STATE_SECRET must differ/,
    );
  });

  it('refuses an encryption key that is not 32 bytes of hex', () => {
    expect(issuesFor(production({ INTEGRATION_ENCRYPTION_KEY: 'too-short' }))).toMatch(/64 hex chars/);
  });

  it('refuses production without a usable LLM key', () => {
    expect(issuesFor(production({ GEMINI_API_KEY: 'replace_with_key' }))).toMatch(/No usable LLM key/);
  });

  it('refuses production without explicit CORS origins', () => {
    expect(issuesFor(production({ CORS_ORIGINS: '' }))).toMatch(/CORS_ORIGINS must be set/);
  });

  describe('Google OAuth', () => {
    const google = {
      GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'https://api.example.com/v1/integrations/google/callback',
    };

    it('boots with none of the three set — the integration is simply off', () => {
      // לפני כן, פרודקשן סירב לעלות בלי Google, ולכן כל פריסה נחסמה
      // עד שיש אפליקציית OAuth מאושרת.
      expect(issuesFor(production())).toBe('');
    });

    it('boots with all three set', () => {
      expect(issuesFor(production(google))).toBe('');
    });

    it('refuses a partial set, naming what is missing', () => {
      const message = issuesFor(production({ GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID }));
      expect(message).toMatch(/GOOGLE_CLIENT_SECRET is missing/);
      expect(message).toMatch(/GOOGLE_REDIRECT_URI is missing/);
      expect(message).not.toMatch(/GOOGLE_CLIENT_ID is missing/);
    });

    it('treats a placeholder as missing, not as configured', () => {
      expect(issuesFor(production({ ...google, GOOGLE_CLIENT_SECRET: 'your-client-secret' }))).toMatch(
        /GOOGLE_CLIENT_SECRET is missing or a placeholder/,
      );
    });
  });
});
