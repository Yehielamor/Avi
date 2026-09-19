import { orderStops, wazeUrl, type Stop } from './route';

/**
 * סדר עבודות שגוי עולה לטכנאי שעה של נסיעה, או גרוע יותר — מביא אותו
 * באיחור לעבודה שהלקוח אישר לה שעה. לכן: מועדים לא זזים, ורק הפנויות
 * מסודרות לפי קרבה.
 */
const at = (h: number) => new Date(`2026-09-20T${String(h).padStart(2, '0')}:00:00Z`);
const stop = (taskId: string, o: Partial<Stop> = {}): Stop => ({
  taskId,
  scheduledStart: null,
  lat: null,
  lng: null,
  address: null,
  ...o,
});

// תל אביב, רמת גן (קרוב), ירושלים (רחוק)
const TLV = { lat: 32.0853, lng: 34.7818 };
const RG = { lat: 32.0684, lng: 34.8248 };
const JLM = { lat: 31.7683, lng: 35.2137 };

describe('orderStops', () => {
  it('keeps scheduled jobs in time order, first', () => {
    const out = orderStops([stop('late', { scheduledStart: at(12) }), stop('early', { scheduledStart: at(8) })], null);
    expect(out.map((s) => s.taskId)).toEqual(['early', 'late']);
  });

  it('never moves a scheduled job to shorten the drive', () => {
    const out = orderStops(
      [
        stop('floating-near', RG),
        stop('scheduled-far', { ...JLM, scheduledStart: at(9) }),
      ],
      TLV,
    );
    expect(out.map((s) => s.taskId)).toEqual(['scheduled-far', 'floating-near']);
  });

  it('orders floating jobs by nearest neighbour from the last scheduled stop', () => {
    const out = orderStops(
      [
        stop('s', { ...TLV, scheduledStart: at(8) }),
        stop('jlm', JLM),
        stop('rg', RG),
      ],
      null,
    );
    expect(out.map((s) => s.taskId)).toEqual(['s', 'rg', 'jlm']);
  });

  it('starts from the technician when nothing is scheduled', () => {
    const out = orderStops([stop('jlm', JLM), stop('rg', RG)], TLV);
    expect(out.map((s) => s.taskId)).toEqual(['rg', 'jlm']);
  });

  it('puts jobs without coordinates last, in their original order', () => {
    const out = orderStops([stop('a'), stop('rg', RG), stop('b')], TLV);
    expect(out.map((s) => s.taskId)).toEqual(['rg', 'a', 'b']);
  });

  it('keeps every job exactly once', () => {
    const input = [stop('1', RG), stop('2', { scheduledStart: at(9) }), stop('3'), stop('4', JLM)];
    expect(orderStops(input, TLV).map((s) => s.taskId).sort()).toEqual(['1', '2', '3', '4']);
  });
});

describe('wazeUrl', () => {
  it('prefers coordinates', () => {
    expect(wazeUrl({ lat: 32.0853, lng: 34.7818, address: 'דיזנגוף 1' })).toBe(
      'https://waze.com/ul?ll=32.085300,34.781800&navigate=yes',
    );
  });

  it('falls back to an encoded address', () => {
    const url = wazeUrl({ lat: null, lng: null, address: 'הרצל 5, חיפה' })!;
    expect(decodeURIComponent(url.split('q=')[1]!.split('&')[0]!)).toBe('הרצל 5, חיפה');
  });

  it('returns null when there is nowhere to go', () => {
    expect(wazeUrl({ lat: null, lng: null, address: '  ' })).toBeNull();
  });
});
