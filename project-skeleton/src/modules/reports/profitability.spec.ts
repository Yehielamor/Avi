import { Prisma } from '@prisma/client';

import { aggregate, type TaskFacts } from './profitability';

/**
 * דו"ח רווח שמציג תמונה ורודה מדי גרוע מבלי דו"ח: בעל העסק מקבל החלטה
 * על בסיסו. כל בדיקה כאן שומרת על אחד מהמקומות שבהם הרווח היה מנופח.
 */
const D = (v: string) => new Prisma.Decimal(v);
const fact = (o: Partial<TaskFacts>): TaskFacts => ({
  taskId: 't',
  jobType: 'ניקוי',
  technician: 'יוסי',
  customer: 'לקוח',
  billed: D('0'),
  estimated: D('0'),
  partsCost: D('0'),
  partsWithoutCost: 0,
  ...o,
});

describe('aggregate', () => {
  it('computes revenue, cost, gross profit and margin exactly', () => {
    const [line] = aggregate([fact({ billed: D('300.10'), partsCost: D('100.05') })], (f) => f.jobType!);
    expect(line).toMatchObject({ revenue: '300.10', partsCost: '100.05', grossProfit: '200.05', marginPct: 67 });
  });

  it('sums cents without float drift', () => {
    const facts = Array.from({ length: 10 }, () => fact({ billed: D('0.10') }));
    expect(aggregate(facts, () => 'x')[0]!.revenue).toBe('1.00');
  });

  it('prefers the billed amount over the estimate', () => {
    const [line] = aggregate([fact({ billed: D('500'), estimated: D('900') })], () => 'x');
    expect(line!.revenue).toBe('500.00');
    expect(line!.hasEstimates).toBe(false);
  });

  it('uses and flags the estimate for an unbilled job', () => {
    const [line] = aggregate([fact({ billed: null, estimated: D('250') })], () => 'x');
    expect(line).toMatchObject({ revenue: '250.00', hasEstimates: true });
  });

  it('marks a line partial when a consumed part has no cost, instead of pretending it was free', () => {
    const [line] = aggregate([fact({ billed: D('100'), partsWithoutCost: 2 })], () => 'x');
    expect(line!.partial).toBe(true);
  });

  it('reports a loss as negative, and has no margin without revenue', () => {
    const [loss] = aggregate([fact({ billed: D('100'), partsCost: D('150') })], () => 'loss');
    expect(loss).toMatchObject({ grossProfit: '-50.00', marginPct: -50 });
    const [none] = aggregate([fact({ billed: null, estimated: D('0'), partsCost: D('10') })], () => 'none');
    expect(none!.marginPct).toBeNull();
  });

  it('groups by the given key and puts the most profitable first', () => {
    const lines = aggregate(
      [
        fact({ jobType: 'התקנה', billed: D('1000') }),
        fact({ jobType: 'ניקוי', billed: D('200') }),
        fact({ jobType: 'ניקוי', billed: D('200') }),
      ],
      (f) => f.jobType!,
    );
    expect(lines.map((l) => [l.key, l.jobs, l.revenue])).toEqual([
      ['התקנה', 1, '1000.00'],
      ['ניקוי', 2, '400.00'],
    ]);
  });

  it('keeps two different people with the same name apart, grouping by id (QA F6)', () => {
    const lines = aggregate(
      [
        fact({ customerId: 'c1', customer: 'משה כהן', billed: D('1000') }),
        fact({ customerId: 'c2', customer: 'משה כהן', billed: D('200') }),
        fact({ customerId: 'c1', customer: 'משה כהן', billed: D('50') }),
      ],
      (f) => ({ id: f.customerId!, label: f.customer }),
    );
    expect(lines.map((l) => [l.id, l.key, l.jobs, l.revenue])).toEqual([
      ['c1', 'משה כהן', 2, '1050.00'],
      ['c2', 'משה כהן', 1, '200.00'],
    ]);
  });

  it('groups rows without an id by their label, with a null id', () => {
    const lines = aggregate(
      [fact({ technicianId: null, technician: null }), fact({ technicianId: null, technician: null })],
      (f) => ({ id: f.technicianId ?? null, label: f.technician ?? 'לא שויך' }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ id: null, key: 'לא שויך', jobs: 2 });
  });
});
