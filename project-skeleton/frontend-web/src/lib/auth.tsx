import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { request, tokenStore, UNAUTHORIZED_EVENT } from './api';
import { authResponseSchema, sessionSchema, type Session } from './schemas';

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
        setSession(s);
        setStatus('authenticated');
      })
      .catch(() => {
        tokenStore.clear();
        setStatus('anonymous');
      });
    return () => ac.abort();
  }, []);

  // 401 מכל קריאה שהיא מסיים את הסשן מיד, בלי לחכות לניווט הבא.
  useEffect(() => {
    const onUnauthorized = () => {
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
    setSession(session);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
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
