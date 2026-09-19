import * as fs from 'node:fs';
import type { Server } from 'node:http';
import * as path from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { PublicTaskStatusController } from '../modules/task-status/task-status.controller';
import { TaskStatusService } from '../modules/task-status/task-status.service';

import { THROTTLERS, THROTTLER_NAMES } from './throttle';

/**
 * QA 18.09, F3: `@Throttle({ default: ... })` על כל הנתיבים הציבוריים התעלם
 * בשקט, כי ה-ThrottlerModule מגדיר רק short/medium/long. שתי בדיקות:
 * אחת סורקת את ה-metadata של כל controller ומוודאת שאין דריסה בשם לא
 * קיים; השנייה מרימה את ה-guard האמיתי ומוודאת 429 אחרי המכסה.
 */

const SRC = path.resolve(__dirname, '..');
const LIMIT_PREFIX = 'THROTTLER:LIMIT';

function controllerFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

/** כל שמות ה-throttler שהוגדרו ב-@Throttle על controller או handler, עם המיקום. */
function throttleOverrides(file: string): Array<{ where: string; name: string }> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(file) as Record<string, unknown>;
  const names = (target: object) =>
    (Reflect.getMetadataKeys(target) as unknown[])
      .filter((k): k is string => typeof k === 'string' && k.startsWith(LIMIT_PREFIX))
      .map((k) => k.slice(LIMIT_PREFIX.length));

  return Object.values(mod)
    .filter((v): v is new (...args: never[]) => unknown => typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v))
    .flatMap((controller) => {
      const proto = controller.prototype as Record<string, unknown>;
      const handlers = Object.getOwnPropertyNames(proto)
        .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
        .map((n) => proto[n] as object & { name: string })
        .filter((h) => Reflect.hasMetadata(METHOD_METADATA, h));
      return [
        ...names(controller).map((name) => ({ where: controller.name, name })),
        ...handlers.flatMap((h) => names(h).map((name) => ({ where: `${controller.name}.${h.name}`, name }))),
      ];
    });
}

describe('throttle overrides', () => {
  const overrides = controllerFiles(SRC).flatMap(throttleOverrides);

  it('actually finds the per-route overrides', () => {
    const where = overrides.map((o) => o.where);
    expect(where).toContain('PublicTaskStatusController.confirm');
    expect(where).toContain('PublicQuoteController.approve');
    expect(where).toContain('PublicBookingController.book');
    expect(where).toContain('AuthController.login');
  });

  it('only overrides throttlers that ThrottlerModule defines (an unknown name is silently ignored)', () => {
    expect(overrides.filter((o) => !THROTTLER_NAMES.has(o.name))).toEqual([]);
  });
});

describe('public link throttling over HTTP', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    const status = {
      view: jest.fn().mockResolvedValue({ ok: true }),
      confirm: jest.fn().mockResolvedValue({ ok: true }),
      requestReschedule: jest.fn().mockResolvedValue({ ok: true }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(THROTTLERS)],
      controllers: [PublicTaskStatusController],
      providers: [
        { provide: TaskStatusService, useValue: status },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers the 6th customer action in a minute with 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await request(app.getHttpServer()).post('/public/status/tok/confirm')).status);
    }
    expect(codes).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('answers the 31st view in a minute with 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) {
      codes.push((await request(app.getHttpServer()).get('/public/status/tok')).status);
    }
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
  });
});
