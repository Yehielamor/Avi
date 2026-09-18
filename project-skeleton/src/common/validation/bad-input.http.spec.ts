import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { EquipmentController, PublicBookingController } from '../../modules/equipment/equipment.controller';
import { EquipmentService } from '../../modules/equipment/equipment.service';
import { QuotesController } from '../../modules/quotes/quotes.controller';
import { QuotesService } from '../../modules/quotes/quotes.service';
import { ReportsController } from '../../modules/reports/reports.controller';
import { ReportsService } from '../../modules/reports/reports.service';
import { PublicTaskStatusController, TaskStatusController } from '../../modules/task-status/task-status.controller';
import { TaskStatusService } from '../../modules/task-status/task-status.service';

import { buildGlobalPipes } from './global-pipes';

/**
 * QA 18.09, F4/F11: קלט פשוט ושגוי הגיע עד ל-DB או ל-`new Date` והחזיר 500.
 * כאן, דרך אותם pipes גלובליים ש-main.ts מתקין, כל אחד מהם הוא 400 —
 * והשירות לא נקרא בכלל.
 */
const NUL = String.fromCharCode(0);
const CUSTOMER = '44444444-4444-4444-4444-444444444444';
const TASK = '22222222-2222-2222-2222-222222222222';

describe('bad input is a 400, not a 500', () => {
  let app: INestApplication;
  const svc = {
    equipment: { book: jest.fn(), create: jest.fn(), update: jest.fn() },
    status: { requestReschedule: jest.fn(), schedule: jest.fn() },
    quotes: { create: jest.fn() },
    reports: { profitability: jest.fn() },
  };
  const called = () =>
    Object.values(svc).flatMap((s) => Object.values(s) as jest.Mock[]).some((fn) => fn.mock.calls.length > 0);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        PublicBookingController,
        EquipmentController,
        PublicTaskStatusController,
        TaskStatusController,
        QuotesController,
        ReportsController,
      ],
      providers: [
        { provide: EquipmentService, useValue: svc.equipment },
        { provide: TaskStatusService, useValue: svc.status },
        { provide: QuotesService, useValue: svc.quotes },
        { provide: ReportsService, useValue: svc.reports },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.tenantId = '11111111-1111-1111-1111-111111111111';
      (req as unknown as { user: object }).user = { id: '33333333-3333-3333-3333-333333333333', role: 'OWNER' };
      next();
    });
    app.useGlobalPipes(...buildGlobalPipes(false));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it.each([
    ['NUL in a reschedule note', () => http().post('/public/status/tok/reschedule').send({ note: `a${NUL}b` })],
    ['booking date 2026-10-32', () => http().post('/public/booking/tok').send({ windows: [{ date: '2026-10-32', part: 'noon' }] })],
    ['booking date 2026-02-30', () => http().post('/public/booking/tok').send({ windows: [{ date: '2026-02-30', part: 'noon' }] })],
    [
      'NUL in a booking note',
      () => http().post('/public/booking/tok').send({ windows: [{ date: '2026-10-01', part: 'morning' }], note: `a${NUL}` }),
    ],
    ['NUL in quote notes', () => http().post('/quotes').send({ customerId: CUSTOMER, priceCodes: ['PIPE'], notes: `a${NUL}b` })],
    ['profitability from 2026-02-30', () => http().get('/reports/profitability?from=2026-02-30&to=2026-03-05')],
    ['profitability year 0000', () => http().get('/reports/profitability?from=0000-01-01&to=0000-12-31')],
    ['profitability month 13', () => http().get('/reports/profitability?from=2026-13-01&to=2026-13-02')],
    ['lastServicedOn 2026-02-30', () => http().post(`/customers/${CUSTOMER}/equipment`).send({ kind: 'x', lastServicedOn: '2026-02-30' })],
    ['lastServicedOn 2026-13-45', () => http().post(`/customers/${CUSTOMER}/equipment`).send({ kind: 'x', lastServicedOn: '2026-13-45' })],
    ['a date-only visit time', () => http().patch(`/tasks/${TASK}/schedule`).send({ scheduledStart: '2026-10-01' })],
  ])('%s', async (_l, send) => {
    const res = await send();
    expect(res.status).toBe(400);
    expect(called()).toBe(false);
  });

  it('names the actual problem for an impossible date, not a misleading range error', async () => {
    const res = await http().get('/reports/profitability?from=2026-13-01&to=2026-13-02');
    expect(JSON.stringify(res.body)).toContain('real date');
  });

  it('still lets valid input through', async () => {
    svc.equipment.book.mockResolvedValue({ booked: true });
    svc.status.schedule.mockResolvedValue({ id: TASK });
    await http().post('/public/booking/tok').send({ windows: [{ date: '2026-10-01', part: 'noon' }], note: 'שלום' }).expect(201);
    await http().patch(`/tasks/${TASK}/schedule`).send({ scheduledStart: '2026-10-01T08:00:00.000Z' }).expect(200);
    await http().patch(`/tasks/${TASK}/schedule`).send({ scheduledStart: '2026-10-01T08:00:00+03:00' }).expect(200);
    expect(svc.equipment.book).toHaveBeenCalledTimes(1);
    expect(svc.status.schedule).toHaveBeenCalledTimes(2);
    svc.equipment.book.mockClear();
    svc.status.schedule.mockClear();
  });
});
