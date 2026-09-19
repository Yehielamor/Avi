import { Prisma } from '@prisma/client';

import { buildActivation, maintenanceEstimate } from './brief';

describe('buildActivation', () => {
  it('keeps the display order and counts completed steps', () => {
    const a = buildActivation({ priceList: 3, equipment: 0, statusLink: 1, quote: 0 });
    expect(a.steps.map((s) => s.key)).toEqual(['priceList', 'equipment', 'statusLink', 'quote']);
    expect(a.steps.map((s) => s.done)).toEqual([true, false, true, false]);
    expect(a).toMatchObject({ completed: 2, total: 4, allDone: false });
  });

  it('is done only when every step is done', () => {
    expect(buildActivation({ priceList: 1, equipment: 1, statusLink: 1, quote: 1 }).allDone).toBe(true);
  });
});

describe('maintenanceEstimate', () => {
  it('multiplies the average job by the count, rounded to whole shekels', () => {
    expect(maintenanceEstimate(new Prisma.Decimal('333.335'), 3)).toBe('1000.00');
  });

  it('returns null without history, never a made-up or zero amount', () => {
    expect(maintenanceEstimate(null, 12)).toBeNull();
  });

  it('returns null when nothing is due', () => {
    expect(maintenanceEstimate(new Prisma.Decimal('400'), 0)).toBeNull();
  });
});
