import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, clearApiCache, request, tokenStore, UNAUTHORIZED_EVENT } from './api';
import { authResponseSchema, sessionSchema, type Session } from './schemas';

/**
 * תמונת מצב של הסשן, לצד הטוקן.
 *
 * "המשימות שלי" צריך את מזהה המשתמש כדי לסנן. באופליין `/auth/me`
 * לא עונה, ובלי התמונה הזו המסך לא היה יכול לדעת מי מחובר — כלומר
 * האופליין היה עובד לכל המסכים חוץ מהמסך הראשי.
 *
 * ב-`sessionStorage` ולא ב-`localStorage`, באותו אורך חיים בדיוק של
 * הטוקן: התמונה הזו לעולם לא תשרוד אותו ולא תתאר משתמש שכבר יצא.
 * היא אינה תעודת הרשאה — ההרשאה היא הטוקן, והשרת בודק אותו בכל בקשה.
 */
const SESSION_KEY = 'craftmind.session';

const sessionStore = {
  get: (): Session | null => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = sessionSchema.safeParse(JSON.parse(raw) as unknown);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  },
  set: (s: Session): void => {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      /* מצב פרטי — נמשיך בלי התמדה */
    }
  },
  clear: (): void => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  },
};

interface AuthState {
  session: Session | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** בדיקת הרשאה. ההרשאות נאכפות בשרת; כאן זה רק הסתרת UI. */
  can: (...roles: Session['user']['role'][]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  // שחזור סשן מטוקן קיים. השרת הוא המקור לאמת — הטוקן לבדו לא
  // מספיק, כי הוא עלול להיות פג או שהמשתמש הושבת מאז.
  useEffect(() => {
    if (!tokenStore.get()) {
      setStatus('anonymous');
      return;
    }
    const ac = new AbortController();
    request('/auth/me', { schema: sessionSchema, signal: ac.signal })
      .then((s) => {
        sessionStore.set(s);
        setSession(s);
        setStatus('authenticated');
      })
      .catch((err: unknown) => {
        // היעדר רשת אינו היעדר הרשאה. הגרסה ב-frontend-web מנקה את
        // הטוקן על כל כישלון — שם זה בסדר, בשולחן עבודה מחובר. כאן
        // זה היה מעיף טכנאי במרתף אל מסך ההתחברות, שם ממילא אין לו
        // רשת להתחבר בה. 401 (טוקן פג / משתמש הושבת) כבר מנוקה
        // ב-`request` עצמו ומגיע דרך UNAUTHORIZED_EVENT.
        const cached = sessionStore.get();
        if (err instanceof ApiError && err.isOffline && cached) {
          setSession(cached);
          setStatus('authenticated');
          return;
        }
        tokenStore.clear();
        sessionStore.clear();
        setStatus('anonymous');
      });
    return () => ac.abort();
  }, []);

  // 401 מכל קריאה שהיא מסיים את הסשן מיד, בלי לחכות לניווט הבא.
  useEffect(() => {
    const onUnauthorized = () => {
      sessionStore.clear();
      setSession(null);
      setStatus('anonymous');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await request('/auth/login', {
      method: 'POST',
      body: { email, password },
      schema: authResponseSchema,
    });
    tokenStore.set(res.accessToken);
    // הטוקן לא נשמר בסשן עצמו — הוא ב-tokenStore. שמירתו גם ב-state
    // הייתה מציגה אותו ב-React DevTools בלי שום צורך.
    const { accessToken: _token, ...session } = res;
    sessionStore.set(session);
    setSession(session);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    sessionStore.clear();
    // המטמון של ה-service worker מחזיק את המשימות של המשתמש הזה,
    // והוא שורד סגירת טאב (בניגוד ל-sessionStorage). בלי הניקוי,
    // המשתמש הבא על אותו מכשיר היה רואה אותן.
    clearApiCache();
    setSession(null);
    setStatus('anonymous');
  }, []);

  const can = useCallback(
    (...roles: Session['user']['role'][]) => (session ? roles.includes(session.user.role) : false),
    [session],
  );

  const value = useMemo<AuthState>(
    () => ({ session, status, login, logout, can }),
    [session, status, login, logout, can],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
