import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui';
import * as api from '@/lib/api';
import type { MyDay, Stop } from '@/lib/schemas';
import { reportSiteLocation } from './field-actions';
import { MyDayPage } from './my-day-page';

/**
 * "היום שלי": סדר העצירות כפי שהשרת קבע, הבא בתור מודגש, Waze וחיוג כקישורים
 * אמיתיים, ו"אני בדרך" פותח את ההודעה לוואטסאפ.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  request: vi.fn(),
  requestCached: vi.fn(),
}));

const request = vi.mocked(api.request);
const requestCached = vi.mocked(api.requestCached);

const stop = (over: Partial<Stop>): Stop => ({
  taskId: '11111111-1111-1111-1111-111111111111',
  title: 'מזגן מטפטף',
  status: 'ASSIGNED',
  priority: 2,
  scheduledStart: null,
  scheduledEnd: null,
  overdue: false,
  confirmed: false,
  rescheduleRequested: false,
  onTheWay: false,
  customer: { name: 'מסעדת הגליל', phone: '0501234567', address: 'הרצל 1 חיפה' },
  hasLocation: false,
  wazeUrl: 'https://waze.com/ul?q=x&navigate=yes',
  ...over,
});

function renderDay(day: MyDay) {
  requestCached.mockResolvedValue({ data: day, fromCache: false, cachedAt: null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MyDayPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  request.mockReset();
  requestCached.mockReset();
});

describe('MyDayPage', () => {
  it('shows stops in the server’s order and marks the first as next', async () => {
    renderDay({
      date: '2026-09-19',
      isToday: true,
      stops: [
        stop({ taskId: '11111111-1111-1111-1111-111111111111', customer: { name: 'ראשון', phone: null, address: null }, scheduledStart: '2026-09-19T06:00:00.000Z', scheduledEnd: '2026-09-19T08:00:00.000Z', confirmed: true }),
        stop({ taskId: '22222222-2222-2222-2222-222222222222', customer: { name: 'שני', phone: '0501234567', address: 'x' } }),
      ],
      done: [],
    });

    const items = await screen.findAllByRole('listitem');
    expect(within(items[0]!).getByText('ראשון')).toBeInTheDocument();
    expect(within(items[0]!).getByText('הבא בתור')).toBeInTheDocument();
    expect(within(items[0]!).getByText('הלקוח אישר')).toBeInTheDocument();
    // 09:00–11:00 שעון ישראל, ב-LTR כדי שהטווח לא יתהפך.
    expect(within(items[0]!).getByText('09:00–11:00')).toHaveAttribute('dir', 'ltr');
    expect(within(items[1]!).getByText('בלי מועד')).toBeInTheDocument();
    expect(within(items[1]!).queryByText('הבא בתור')).not.toBeInTheDocument();
  });

  it('offers Waze and a call as real links, and says so when they are missing', async () => {
    renderDay({ date: '2026-09-19', isToday: true, stops: [stop({ customer: { name: 'x', phone: null, address: null }, wazeUrl: null })], done: [] });
    expect(await screen.findByText('אין כתובת')).toBeInTheDocument();
    expect(screen.getByText('אין טלפון')).toBeInTheDocument();
  });

  it('turns "I’m on the way" into a WhatsApp message for the customer', async () => {
    renderDay({ date: '2026-09-19', isToday: true, stops: [stop({})], done: [] });
    request.mockResolvedValue({ url: 'https://c/s/t', waUrl: 'https://wa.me/972501234567?text=x', message: 'יוסי בדרך אליך' });

    fireEvent.click(await screen.findByRole('button', { name: /אני בדרך/ }));

    await waitFor(() => expect(screen.getByText('יוסי בדרך אליך')).toBeInTheDocument());
    expect(request).toHaveBeenCalledWith('/tasks/11111111-1111-1111-1111-111111111111/on-the-way', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByRole('link', { name: /פתיחה ב-WhatsApp/ })).toHaveAttribute('href', 'https://wa.me/972501234567?text=x');
  });

  it('says the day is done when only finished jobs remain', async () => {
    renderDay({ date: '2026-09-19', isToday: true, stops: [], done: [stop({ status: 'CLOSED' })] });
    expect(await screen.findByText('סיימת להיום')).toBeInTheDocument();
    expect(screen.getByText('הושלמו היום')).toBeInTheDocument();
  });
});

describe('reportSiteLocation', () => {
  it('sends the phone’s position for the task', () => {
    request.mockResolvedValue({ saved: true });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 32.8, longitude: 35, accuracy: 12 } } as GeolocationPosition) },
    });
    reportSiteLocation('11111111-1111-1111-1111-111111111111');
    expect(request).toHaveBeenCalledWith('/tasks/11111111-1111-1111-1111-111111111111/site-location', {
      method: 'POST',
      body: { lat: 32.8, lng: 35, accuracyM: 12 },
    });
  });

  it('does nothing when the technician declines location', () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError) },
    });
    reportSiteLocation('11111111-1111-1111-1111-111111111111');
    expect(request).not.toHaveBeenCalled();
  });
});
