import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import type { NextFunction, Request, Response } from 'express';

import { TenantContextMiddleware } from './tenant-context.middleware';
import type { PrismaService } from '../database/prisma.service';

/**
 * זיהוי הטננט הוא הנקודה שבה נקבע מי רואה מה. טעות כאן אינה באג
 * בתצוגה — היא דליפה בין עסקים.
 *
 * הבדיקות כאן ממוקדות בשלושה כשלים שנמצאו בביקורת:
 *   • `startsWith('www.')` שאפשר לטננט בשם "wwwtest" לדלג על זיהוי
 *   • הודעת שגיאה שהכילה את שם התת-דומיין ואפשרה מניית טננטים
 *   • כותרת X-Tenant שנוספה מאוחר, ושלא עברה את אותם כללי ולידציה
 */
describe('TenantContextMiddleware', () => {
  const TENANT_ID = '11111111-1111-1111-1111-111111111111';

  let resolve: jest.Mock;
  let middleware: TenantContextMiddleware;
  let next: NextFunction;

  const makeReq = (host: string, headers: Record<string, string> = {}): Request => {
    const all: Record<string, string> = { host, ...headers };
    return {
      headers: all,
      header: (name: string) => all[name.toLowerCase()],
    } as unknown as Request;
  };

  const res = { setHeader: jest.fn() } as unknown as Response;

  beforeEach(() => {
    resolve = jest.fn().mockResolvedValue(TENANT_ID);
    const prisma = { resolveTenantBySubdomain: resolve } as unknown as PrismaService;
    const config = { get: () => 'craftmind-ai.com' } as unknown as ConfigService<AppEnv, true>;
    middleware = new TenantContextMiddleware(prisma, config);
    next = jest.fn();
  });

  describe('subdomain extraction', () => {
    it('resolves a tenant subdomain', async () => {
      const req = makeReq('acme.craftmind-ai.com');
      await middleware.use(req, res, next);

      expect(resolve).toHaveBeenCalledWith('acme');
      expect(req.tenantId).toBe(TENANT_ID);
      expect(next).toHaveBeenCalled();
    });

    it('ignores the port', async () => {
      await middleware.use(makeReq('acme.craftmind-ai.com:3000'), res, next);
      expect(resolve).toHaveBeenCalledWith('acme');
    });

    it('treats the bare base domain as tenantless', async () => {
      const req = makeReq('craftmind-ai.com');
      await middleware.use(req, res, next);

      expect(resolve).not.toHaveBeenCalled();
      expect(req.tenantId).toBeUndefined();
      expect(next).toHaveBeenCalled();
    });

    it('rejects a host that merely ends with the base domain', async () => {
      // "evilcraftmind-ai.com" אינו תת-דומיין שלנו. התאמת סיומת
      // נאיבית הייתה מקבלת אותו.
      await middleware.use(makeReq('evilcraftmind-ai.com'), res, next);
      expect(resolve).not.toHaveBeenCalled();
    });

    it.each(['www', 'bi', 'api', 'admin'])('treats %s as infrastructure, not a tenant', async (label) => {
      await middleware.use(makeReq(`${label}.craftmind-ai.com`), res, next);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('does NOT skip a tenant whose name merely starts with a reserved word', async () => {
      // הבאג המקורי: startsWith('www.') תפס גם "wwwtest", וזה דילג
      // על זיהוי הטננט לגמרי.
      await middleware.use(makeReq('wwwtest.craftmind-ai.com'), res, next);
      expect(resolve).toHaveBeenCalledWith('wwwtest');
    });

    it('rejects a multi-level subdomain rather than guessing', async () => {
      await middleware.use(makeReq('a.b.craftmind-ai.com'), res, next);
      expect(resolve).not.toHaveBeenCalled();
    });

    it('treats localhost as tenantless', async () => {
      await middleware.use(makeReq('localhost:5173'), res, next);
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe('X-Tenant fallback', () => {
    it('is used when the host carries no tenant subdomain', async () => {
      const req = makeReq('api.example.com', { 'x-tenant': 'acme' });
      await middleware.use(req, res, next);

      expect(resolve).toHaveBeenCalledWith('acme');
      expect(req.tenantId).toBe(TENANT_ID);
    });

    it('does not override a subdomain that is already present', async () => {
      // הכותרת היא נפילה-אחורה, לא דריסה. אחרת לקוח היה יכול
      // להצהיר טננט אחר מזה שבכתובת.
      await middleware.use(makeReq('acme.craftmind-ai.com', { 'x-tenant': 'other' }), res, next);
      expect(resolve).toHaveBeenCalledWith('acme');
    });

    it('normalises case and whitespace', async () => {
      await middleware.use(makeReq('api.example.com', { 'x-tenant': '  ACME  ' }), res, next);
      expect(resolve).toHaveBeenCalledWith('acme');
    });

    it.each(['bad_value', 'has space', '-leading', 'trailing-', 'a'.repeat(64), '../etc', ''])(
      'rejects the malformed value %j',
      async (value) => {
        await middleware.use(makeReq('api.example.com', { 'x-tenant': value }), res, next);
        expect(resolve).not.toHaveBeenCalled();
      },
    );

    it('applies the reserved-name list to the header too', async () => {
      await middleware.use(makeReq('api.example.com', { 'x-tenant': 'admin' }), res, next);
      expect(resolve).not.toHaveBeenCalled();
    });
  });

  describe('unknown tenant', () => {
    it('throws NotFound without naming the subdomain', async () => {
      resolve.mockResolvedValue(null);
      const req = makeReq('does-not-exist.craftmind-ai.com');

      await expect(middleware.use(req, res, next)).rejects.toBeInstanceOf(NotFoundException);
      expect(next).not.toHaveBeenCalled();

      // הודעה שמכילה את השם מאפשרת למנות אילו טננטים קיימים.
      await expect(middleware.use(req, res, next)).rejects.toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('does-not-exist') }),
      );
    });
  });

  describe('request id', () => {
    it('reuses an incoming x-request-id', async () => {
      const req = makeReq('acme.craftmind-ai.com', { 'x-request-id': 'abc-123' });
      await middleware.use(req, res, next);

      expect(req.requestId).toBe('abc-123');
      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
    });

    it('generates one when absent', async () => {
      const req = makeReq('acme.craftmind-ai.com');
      await middleware.use(req, res, next);
      expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
