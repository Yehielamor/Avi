import { TaskStatus } from '@prisma/client';

import { deriveCustomerStatus, firstName, formatVisit } from './customer-status';

describe('deriveCustomerStatus', () => {
  const base = { status: TaskStatus.NEW, scheduledStart: null, onTheWayAt: null };

  it.each([
    ['received', base],
    ['scheduled', { ...base, scheduledStart: new Date() }],
    ['on_the_way', { ...base, scheduledStart: new Date(), onTheWayAt: new Date() }],
    // סגירה גוברת על "בדרך" — אחרת לקוח רואה "בדרך" לעבודה שהסתיימה.
    ['done', { ...base, status: TaskStatus.CLOSED, onTheWayAt: new Date() }],
    ['cancelled', { ...base, status: TaskStatus.CANCELLED, scheduledStart: new Date() }],
  ] as const)('shows %s', (expected, task) => {
    expect(deriveCustomerStatus(task)).toBe(expected);
  });
});

describe('firstName', () => {
  it.each([
    ['יוסי כהן', 'יוסי'],
    ['  דנה   לוי ', 'דנה'],
    ['אבי', 'אבי'],
  ])('%s → %s', (full, expected) => {
    expect(firstName(full)).toBe(expected);
  });

  it('is null for a missing name', () => {
    expect(firstName(null)).toBeNull();
  });
});

describe('formatVisit', () => {
  it('shows Israel time, not the server’s', () => {
    // 07:00Z בספטמבר = 10:00 שעון קיץ ישראלי. שרת ב-UTC היה כותב 07:00.
    const text = formatVisit(new Date('2026-09-20T07:00:00Z'), new Date('2026-09-20T09:00:00Z'));
    expect(text).toContain('בין 10:00 ל-12:00');
  });

  it('never writes a bare numeric range, which RTL rendering reverses', () => {
    const text = formatVisit(new Date('2026-09-20T07:00:00Z'), new Date('2026-09-20T09:00:00Z'));
    expect(text).not.toMatch(/\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}/);
  });
});
