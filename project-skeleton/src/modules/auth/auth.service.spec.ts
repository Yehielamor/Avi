import { ConflictException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, UserRole, Vertical } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import {
  ACCESS_TOKEN_AUDIENCE,
  ACCESS_TOKEN_ISSUER,
  ACCESS_TOKEN_PURPOSE,
  AuthService,
} from './auth.service';
import type { AppEnv } from '../../config/env.schema';
import type { PrismaService, TenantClient } from '../../database/prisma.service';

/** `mock.calls` מוקלד כ-any; כאן הוא נחשף כ-unknown, כך שכל בדיקה חייבת לומר מה היא מצפה למצוא. */
function callsOf(fn: jest.Mock): unknown[][] {
  return fn.mock.calls as unknown[][];
}

/** ארגומנט `arg` של קריאה מספר `call` ל-mock. */
function callArg(fn: jest.Mock, call = 0, arg = 0): unknown {
  return callsOf(fn)[call]?.[arg];
}

// bcrypt בעלות 12 הוא ~300ms לכל קריאה. הבדיקות כאן עוסקות בזרימת
// ההחלטה ולא ב-KDF עצמו, ולכן הוא ממוקק — וכך גם אפשר לבדוק *במה*
// הוא נקרא, מה שנחוץ לבדיקת ההשוואה המדומה.
jest.mock('bcrypt');

// `hash`/`compare` הם overloads שאחד מהם מקבל callback ומחזיר void, ולכן
// `jest.Mocked<typeof bcrypt>` נותן להם טיפוס שלא מקבל Promise. כאן הם
// מוקלדים לפי ה-overload שה-service משתמש בו בפועל.
type HashFn = (data: string | Buffer, saltOrRounds: string | number) => Promise<string>;
type CompareFn = (data: string | Buffer, encrypted: string) => Promise<boolean>;
const mockedBcrypt = {
  hash: bcrypt.hash as unknown as jest.MockedFunction<HashFn>,
  compare: bcrypt.compare as unknown as jest.MockedFunction<CompareFn>,
};

/**
 * שלוש הפרצות שהבדיקות כאן שומרות סגורות:
 *
 *   • I2 — `POST /auth/register {"role":"OWNER"}` הפך לקוח לבעלים.
 *     התפקיד מקובע ב-service, לא מתקבל מהבקשה.
 *   • C6 — טוקן ה-state של OAuth, שנוסע ב-query string דרך הלוגים של
 *     Google, שימש כטוקן גישה מלא. `aud`/`iss`/`purpose` הם מה שחוסם.
 *   • מניית משתמשים — אימייל לא קיים וסיסמה שגויה חייבים להחזיר
 *     אותה שגיאה, ולצרוך אותו זמן.
 */
/**
 * login מחזיר AuthResponse, ולכן catch מייצר איחוד טיפוסים ו-`.message`
 * אינו קיים עליו. העוזר הזה מצמצם לשגיאה, ונכשל במפורש אם הקריאה
 * דווקא הצליחה — מה שאחרת היה עובר כבדיקה ירוקה על שום דבר.
 */
/** מסיר מפתחות שערכם undefined. ראה ההערה ב-signWith. */
function omitUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

async function captureError(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected the call to reject, but it resolved');
}

describe('AuthService', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';
  const OTHER_TENANT_ID = '22222222-2222-2222-2222-222222222222';
  const USER_ID = '33333333-3333-3333-3333-333333333333';
  const JWT_SECRET = 'unit-test-secret';

  const tenantRow = {
    id: TENANT_ID,
    name: 'Acme',
    subdomain: 'acme',
    vertical: Vertical.MAINTENANCE,
  };

  const userRow = {
    id: USER_ID,
    tenantId: TENANT_ID,
    email: 'user@example.com',
    name: 'User',
    role: UserRole.FIELD,
    passwordHash: 'stored-hash',
    isActive: true,
    mustChangePassword: false,
  };

  let tx: {
    user: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    tenant: { findFirst: jest.Mock };
  };
  let forTenant: jest.Mock;
  let jwt: JwtService;
  let service: AuthService;

  beforeEach(() => {
    tx = {
      user: {
        create: jest.fn().mockResolvedValue(userRow),
        findUnique: jest.fn().mockResolvedValue(userRow),
        findFirst: jest.fn().mockResolvedValue(userRow),
        update: jest.fn().mockResolvedValue({ ...userRow, mustChangePassword: false }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: { findFirst: jest.fn().mockResolvedValue(tenantRow) },
    };

    forTenant = jest.fn(
      async <T,>(_tenantId: string, fn: (client: TenantClient) => Promise<T>): Promise<T> =>
        fn(tx as unknown as TenantClient),
    );

    const prisma = { forTenant } as unknown as PrismaService;
    const config = { get: () => '12h' } as unknown as ConfigService<AppEnv, true>;

    jwt = new JwtService({ secret: JWT_SECRET });
    service = new AuthService(prisma, jwt, config);

    mockedBcrypt.hash.mockResolvedValue('new-hash');
    mockedBcrypt.compare.mockResolvedValue(true);
  });

  const decode = (token: string): Record<string, unknown> =>
    jwt.verify<Record<string, unknown>>(token, {
      audience: ACCESS_TOKEN_AUDIENCE,
      issuer: ACCESS_TOKEN_ISSUER,
    });

  // ---------------------------------------------------------------------------

  describe('register', () => {
    const params = { email: 'new@example.com', password: 'pw', name: 'New' };

    it('creates the user with the FIELD role', async () => {
      await service.register(TENANT_ID, params);

      expect(tx.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: UserRole.FIELD }) as unknown,
        }),
      );
    });

    it('ignores a role supplied by the client', async () => {
      // הפרצה המקורית: הגוף עבר כמו שהוא אל prisma.create, ולכן
      // `{"role":"OWNER"}` יצר בעלים. זה היה חי בפרודקשן.
      await service.register(TENANT_ID, {
        ...params,
        role: UserRole.OWNER,
      } as unknown as typeof params);

      const call = callArg(tx.user.create) as { data: { role: UserRole } };
      expect(call.data.role).toBe(UserRole.FIELD);
    });

    it.each([UserRole.OWNER, UserRole.MANAGER, UserRole.FIELD])(
      'ignores a supplied role of %s',
      async (role) => {
        await service.register(TENANT_ID, { ...params, role } as unknown as typeof params);

        const call = callArg(tx.user.create) as { data: { role: UserRole } };
        expect(call.data.role).toBe(UserRole.FIELD);
      },
    );

    it('never returns a token claiming a role other than the one it stored', async () => {
      tx.user.create.mockResolvedValue({ ...userRow, role: UserRole.FIELD });

      const result = await service.register(TENANT_ID, {
        ...params,
        role: UserRole.OWNER,
      } as unknown as typeof params);

      expect(result.user.role).toBe(UserRole.FIELD);
      expect(decode(result.accessToken).role).toBe(UserRole.FIELD);
    });

    it('binds the user to the tenant from the request, not from the body', async () => {
      await service.register(TENANT_ID, {
        ...params,
        tenantId: OTHER_TENANT_ID,
      } as unknown as typeof params);

      expect(forTenant).toHaveBeenCalledWith(TENANT_ID, expect.any(Function));
      const call = callArg(tx.user.create) as { data: { tenantId: string } };
      expect(call.data.tenantId).toBe(TENANT_ID);
    });

    it('normalises the email to lower case and trims it', async () => {
      await service.register(TENANT_ID, { ...params, email: '  New@Example.COM ' });

      const call = callArg(tx.user.create) as { data: { email: string } };
      expect(call.data.email).toBe('new@example.com');
    });

    it('stores a hash, never the password itself', async () => {
      await service.register(TENANT_ID, params);

      expect(mockedBcrypt.hash).toHaveBeenCalledWith('pw', 12);
      const call = callArg(tx.user.create) as { data: { passwordHash: string } };
      expect(call.data.passwordHash).toBe('new-hash');
      expect(JSON.stringify(call)).not.toContain('pw"');
    });

    it('hashes before opening the transaction', async () => {
      // bcrypt בעלות 12 בתוך forTenant מחזיק חיבור DB ל-~300ms לכל הרשמה.
      const order: string[] = [];
      mockedBcrypt.hash.mockImplementation(() => {
        order.push('hash');
        return Promise.resolve('new-hash');
      });
      forTenant.mockImplementation(
        async <T,>(_t: string, fn: (client: TenantClient) => Promise<T>): Promise<T> => {
          order.push('tx');
          return fn(tx as unknown as TenantClient);
        },
      );

      await service.register(TENANT_ID, params);
      expect(order[0]).toBe('hash');
    });

    it('translates a unique-constraint violation into 409', async () => {
      tx.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.register(TENANT_ID, params)).rejects.toBeInstanceOf(ConflictException);
    });

    it('does not swallow an unrelated database error', async () => {
      tx.user.create.mockRejectedValue(new Error('connection reset'));
      await expect(service.register(TENANT_ID, params)).rejects.toThrow('connection reset');
    });
  });

  // ---------------------------------------------------------------------------

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      const result = await service.login(TENANT_ID, 'user@example.com', 'pw');

      expect(result.user.id).toBe(USER_ID);
      expect(decode(result.accessToken).sub).toBe(USER_ID);
    });

    it('normalises the email before looking it up', async () => {
      await service.login(TENANT_ID, '  User@Example.COM  ', 'pw');

      expect(tx.user.findUnique).toHaveBeenCalledWith({
        where: { tenantId_email: { tenantId: TENANT_ID, email: 'user@example.com' } },
      });
    });

    describe('user enumeration', () => {
      it('gives the same error for an unknown email and a wrong password', async () => {
        tx.user.findUnique.mockResolvedValue(null);
        const unknownEmail = await captureError(service.login(TENANT_ID, 'nobody@example.com', 'pw'));

        tx.user.findUnique.mockResolvedValue(userRow);
        mockedBcrypt.compare.mockResolvedValue(false);
        const wrongPassword = await captureError(service.login(TENANT_ID, 'user@example.com', 'wrong'));

        expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
        expect(wrongPassword).toBeInstanceOf(UnauthorizedException);
        expect(unknownEmail.message).toBe('Invalid credentials');
        expect(wrongPassword.message).toBe(unknownEmail.message);
      });

      it('performs a dummy compare for an unknown email', async () => {
        // בלי זה, כניסה עם אימייל לא קיים חוזרת מיידית וכניסה עם
        // אימייל קיים לוקחת ~300ms — וזמן התגובה מסגיר מי רשום.
        tx.user.findUnique.mockResolvedValue(null);

        await expect(service.login(TENANT_ID, 'nobody@example.com', 'pw')).rejects.toThrow();

        expect(mockedBcrypt.compare).toHaveBeenCalledTimes(1);
        const [, hash] = mockedBcrypt.compare.mock.calls[0] ?? [];
        expect(typeof hash).toBe('string');
        expect(hash as string).toMatch(/^\$2[aby]\$12\$/);
      });

      it('performs a compare even for a deactivated user', async () => {
        tx.user.findUnique.mockResolvedValue({ ...userRow, isActive: false });

        await expect(service.login(TENANT_ID, 'user@example.com', 'pw')).rejects.toThrow(
          'Invalid credentials',
        );
        expect(mockedBcrypt.compare).toHaveBeenCalledTimes(1);
      });

      it('gives the same error for a deactivated user as for a wrong password', async () => {
        tx.user.findUnique.mockResolvedValue({ ...userRow, isActive: false });
        const inactive = await captureError(service.login(TENANT_ID, 'user@example.com', 'pw'));

        expect(inactive.message).toBe('Invalid credentials');
      });

      it('does not leak the email or the tenant in the error message', async () => {
        tx.user.findUnique.mockResolvedValue(null);
        const err = await captureError(service.login(TENANT_ID, 'nobody@example.com', 'pw'));

        expect(err.message).not.toContain('nobody@example.com');
        expect(err.message).not.toContain(TENANT_ID);
      });
    });

    describe('lastLoginAt', () => {
      it('is written on success', async () => {
        await service.login(TENANT_ID, 'user@example.com', 'pw');

        expect(tx.user.updateMany).toHaveBeenCalledWith({
          where: { id: USER_ID, tenantId: TENANT_ID },
          data: { lastLoginAt: expect.any(Date) as unknown },
        });
      });

      it('is not written for a wrong password', async () => {
        mockedBcrypt.compare.mockResolvedValue(false);

        await expect(service.login(TENANT_ID, 'user@example.com', 'wrong')).rejects.toThrow();
        expect(tx.user.updateMany).not.toHaveBeenCalled();
      });

      it('is not written for an unknown email', async () => {
        tx.user.findUnique.mockResolvedValue(null);

        await expect(service.login(TENANT_ID, 'nobody@example.com', 'pw')).rejects.toThrow();
        expect(tx.user.updateMany).not.toHaveBeenCalled();
      });

      it('is not written for a deactivated user', async () => {
        tx.user.findUnique.mockResolvedValue({ ...userRow, isActive: false });

        await expect(service.login(TENANT_ID, 'user@example.com', 'pw')).rejects.toThrow();
        expect(tx.user.updateMany).not.toHaveBeenCalled();
      });
    });

    it('runs every query under the tenant context', async () => {
      await service.login(TENANT_ID, 'user@example.com', 'pw');

      for (const call of callsOf(forTenant)) {
        expect(call[0]).toBe(TENANT_ID);
      }
    });
  });

  // ---------------------------------------------------------------------------

  describe('issued tokens', () => {
    const issue = async (): Promise<string> =>
      (await service.login(TENANT_ID, 'user@example.com', 'pw')).accessToken;

    it('carries aud, iss and purpose', async () => {
      const payload = decode(await issue());

      expect(payload.aud).toBe(ACCESS_TOKEN_AUDIENCE);
      expect(payload.iss).toBe(ACCESS_TOKEN_ISSUER);
      expect(payload.purpose).toBe(ACCESS_TOKEN_PURPOSE);
    });

    it('carries the identity the guard needs and nothing secret', async () => {
      const payload = decode(await issue());

      expect(payload.sub).toBe(USER_ID);
      expect(payload.tenantId).toBe(TENANT_ID);
      expect(payload.role).toBe(UserRole.FIELD);
      expect(payload.mustChangePassword).toBe(false);
      expect(payload).not.toHaveProperty('passwordHash');
      expect(JSON.stringify(payload)).not.toContain('stored-hash');
    });

    it('expires', async () => {
      const payload = decode(await issue());
      expect(typeof payload.exp).toBe('number');
    });
  });

  // ---------------------------------------------------------------------------

  describe('verifyToken', () => {
    const validPayload = {
      sub: USER_ID,
      tenantId: TENANT_ID,
      role: UserRole.FIELD,
      purpose: ACCESS_TOKEN_PURPOSE,
      mustChangePassword: false,
    };

    /** חותם עם *אותו סוד* — בדיוק מה שעשה טוקן ה-state של OAuth. */
    const signWith = (
      payload: Record<string, unknown>,
      options: Record<string, unknown> = {},
    ): string =>
      jwt.sign(
        payload,
        // jwt.sign מוודא שכל מפתח שקיים הוא מהטיפוס הנכון, ולכן
        // `audience: undefined` נופל במקום להתפרש כ"בלי audience".
        // השמטה מפורשת היא הדרך היחידה לחתום טוקן חסר-aud.
        omitUndefined({
          audience: ACCESS_TOKEN_AUDIENCE,
          issuer: ACCESS_TOKEN_ISSUER,
          expiresIn: '1h',
          ...options,
        }),
      );

    it('accepts a token this service issued', async () => {
      const token = (await service.login(TENANT_ID, 'user@example.com', 'pw')).accessToken;
      const payload = service.verifyToken(token);

      expect(payload.sub).toBe(USER_ID);
      expect(payload.tenantId).toBe(TENANT_ID);
      expect(payload.role).toBe(UserRole.FIELD);
    });

    describe('cross-purpose replay (audit C6)', () => {
      it('rejects an OAuth state token signed with the same secret', () => {
        // הערך הזה נוסע ב-query string דרך השרתים של Google, שורת
        // הכתובת וה-Referer. פעם הוא התקבל כ-Bearer מלא.
        const stateToken = jwt.sign(
          { tenantId: TENANT_ID, purpose: 'oauth_state', nonce: 'abc' },
          { expiresIn: '10m' },
        );

        expect(() => service.verifyToken(stateToken)).toThrow(UnauthorizedException);
      });

      it.each([
        ['no aud and no iss', {}, { audience: undefined, issuer: undefined }],
        ['a foreign audience', {}, { audience: 'someone-else' }],
        ['a foreign issuer', {}, { issuer: 'someone-else' }],
        ['a foreign purpose', { purpose: 'oauth_state' }, {}],
        ['a missing purpose', { purpose: undefined }, {}],
        ['a null purpose', { purpose: null }, {}],
      ])('rejects a token with %s', (_label, payloadOverride, optionOverride) => {
        const token = signWith({ ...validPayload, ...payloadOverride }, optionOverride);
        expect(() => service.verifyToken(token)).toThrow(UnauthorizedException);
      });

      it('gives the same message whatever the reason, so nothing is hinted', () => {
        const reasons = [
          signWith(validPayload, { audience: 'other' }),
          signWith(validPayload, { issuer: 'other' }),
          signWith({ ...validPayload, purpose: 'oauth_state' }),
          signWith(validPayload, { expiresIn: '-1s' }),
          'not.a.token',
        ].map((token) => {
          try {
            service.verifyToken(token);
            return 'accepted';
          } catch (err) {
            return (err as Error).message;
          }
        });

        expect(new Set(reasons)).toEqual(new Set(['Invalid or expired token']));
      });
    });

    describe('structural checks', () => {
      it('rejects an expired token', () => {
        expect(() => service.verifyToken(signWith(validPayload, { expiresIn: '-1s' }))).toThrow(
          UnauthorizedException,
        );
      });

      it('rejects a token signed with a different secret', () => {
        const foreign = new JwtService({ secret: 'not-our-secret' }).sign(validPayload, {
          audience: ACCESS_TOKEN_AUDIENCE,
          issuer: ACCESS_TOKEN_ISSUER,
          expiresIn: '1h',
        });

        expect(() => service.verifyToken(foreign)).toThrow(UnauthorizedException);
      });

      it.each([
        ['missing sub', { sub: undefined }],
        ['empty sub', { sub: '' }],
        ['missing tenantId', { tenantId: undefined }],
        ['empty tenantId', { tenantId: '' }],
        ['an unknown role', { role: 'SUPERADMIN' }],
        ['a missing role', { role: undefined }],
        ['a lower-case role', { role: 'owner' }],
      ])('rejects a token with %s', (_label, override) => {
        const token = signWith({ ...validPayload, ...override });
        expect(() => service.verifyToken(token)).toThrow(UnauthorizedException);
      });

      it.each(['', 'garbage', 'a.b', 'a.b.c', `${'x'.repeat(200)}.y.z`])(
        'rejects the malformed token %j without crashing',
        (token) => {
          expect(() => service.verifyToken(token)).toThrow(UnauthorizedException);
        },
      );

      it('rejects an unsigned (alg=none) token', () => {
        const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
          'base64url',
        );
        const body = Buffer.from(
          JSON.stringify({ ...validPayload, aud: ACCESS_TOKEN_AUDIENCE, iss: ACCESS_TOKEN_ISSUER }),
        ).toString('base64url');

        expect(() => service.verifyToken(`${header}.${body}.`)).toThrow(UnauthorizedException);
      });
    });
  });

  // ---------------------------------------------------------------------------

  describe('changePassword', () => {
    it('clears mustChangePassword and stores the new hash', async () => {
      tx.user.findFirst.mockResolvedValue({ ...userRow, mustChangePassword: true });

      await service.changePassword(TENANT_ID, USER_ID, 'old', 'new');

      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { passwordHash: 'new-hash', mustChangePassword: false },
      });
    });

    it('rejects a wrong current password without writing anything', async () => {
      mockedBcrypt.compare.mockResolvedValue(false);

      await expect(service.changePassword(TENANT_ID, USER_ID, 'wrong', 'new')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(mockedBcrypt.hash).not.toHaveBeenCalled();
    });

    it('rejects a deactivated user', async () => {
      tx.user.findFirst.mockResolvedValue({ ...userRow, isActive: false });

      await expect(service.changePassword(TENANT_ID, USER_ID, 'old', 'new')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('returns a token whose flag is already cleared', async () => {
      tx.user.update.mockResolvedValue({ ...userRow, mustChangePassword: false });

      const result = await service.changePassword(TENANT_ID, USER_ID, 'old', 'new');

      expect(result.mustChangePassword).toBe(false);
      expect(decode(result.accessToken).mustChangePassword).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------

  describe('getSession', () => {
    it('reads the role from the database rather than trusting the token', async () => {
      // תפקיד יכול היה להשתנות מאז ההנפקה; החזרת הערך מהטוקן הייתה
      // משאירה את הקליינט עם הרשאה שכבר נשללה.
      tx.user.findFirst.mockResolvedValue({
        id: USER_ID,
        name: 'User',
        email: 'user@example.com',
        role: UserRole.MANAGER,
        mustChangePassword: false,
      });

      const session = await service.getSession(TENANT_ID, USER_ID);
      expect(session.user.role).toBe(UserRole.MANAGER);
      expect(tx.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID, tenantId: TENANT_ID, isActive: true },
        }),
      );
    });

    it('rejects a user who has since been deactivated', async () => {
      tx.user.findFirst.mockResolvedValue(null);

      await expect(service.getSession(TENANT_ID, USER_ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects when the tenant cannot be loaded', async () => {
      tx.tenant.findFirst.mockResolvedValue(null);

      await expect(service.getSession(TENANT_ID, USER_ID)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
