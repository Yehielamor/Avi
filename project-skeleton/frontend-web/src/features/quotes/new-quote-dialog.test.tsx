import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import * as api from '@/lib/api';
import { NewQuoteDialog } from './quotes-page';

/**
 * דיאלוג הצעת מחיר חדשה — חיפוש הלקוח.
 *
 * רשימת תוצאות החיפוש ישבה בעבר בתוך <Field>, ש-Children.only בו הפיל
 * את כל המסך ברגע שהופיעו תוצאות. הבדיקה מוודאת שהדיאלוג מרונדר, מציג
 * תוצאות ומאפשר לבחור לקוח בלי לזרוק.
 */
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  request: vi.fn(),
}));

const request = vi.mocked(api.request);

const customers = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'דני כהן', createdAt: '2026-09-01T10:00:00.000Z' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'דנה לוי', createdAt: '2026-09-02T10:00:00.000Z' },
];

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  render(<NewQuoteDialog onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: wrap });
}

beforeEach(() => {
  request.mockReset();
  request.mockImplementation((path: string) => {
    if (path.startsWith('/customers/search')) return Promise.resolve(customers);
    if (path.startsWith('/price-list')) return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected request: ${path}`));
  });
});

describe('NewQuoteDialog — customer search', () => {
  it('shows search results without crashing, and keeps aria on the input', async () => {
    renderDialog();

    const input = screen.getByLabelText(/^לקוח/);
    fireEvent.change(input, { target: { value: 'דנ' } });

    expect(await screen.findByRole('button', { name: 'דני כהן' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'דנה לוי' })).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith(
      `/customers/search?q=${encodeURIComponent('דנ')}`,
      expect.anything(),
    );

    // Field עדיין משכפל את הילד היחיד שלו: ה-hint מקושר לשדה עצמו.
    expect(input).toHaveAttribute('id', 'q-customer');
    expect(input).toHaveAttribute('aria-describedby', 'q-customer-hint');
  });

  it('selects a customer from the results', async () => {
    renderDialog();

    fireEvent.change(screen.getByLabelText(/^לקוח/), { target: { value: 'דנ' } });
    fireEvent.click(await screen.findByRole('button', { name: 'דנה לוי' }));

    expect(screen.getByText('דנה לוי')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'החלפה' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^לקוח/)).not.toBeInTheDocument();
  });
});

/**
 * QA 18.09, F5: יצירת הצעה לא שלחה Idempotency-Key, ולכן ניסיון חוזר אחרי
 * timeout יצר הצעה שנייה עם מספר רץ חדש. אותה הגשה = אותו מפתח; תוכן שונה
 * = מפתח חדש (אחרת השרת דוחה ב-422).
 */
describe('NewQuoteDialog — idempotent create', () => {
  const price = {
    id: '33333333-3333-3333-3333-333333333333',
    code: 'SERVICE',
    description: 'טיפול תקופתי',
    price: '350.00',
    isActive: true,
    usedByTemplates: 0,
    updatedAt: '2026-09-01T10:00:00.000Z',
  };

  beforeEach(() => {
    request.mockImplementation((path: string) => {
      if (path.startsWith('/customers/search')) return Promise.resolve(customers);
      if (path.startsWith('/price-list')) return Promise.resolve([price]);
      if (path === '/quotes') return Promise.reject(new api.ApiError(0, 'network'));
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });
  });

  const keysSent = () =>
    request.mock.calls
      .filter(([path]) => path === '/quotes')
      .map(([, opts]) => (opts as { idempotencyKey?: string }).idempotencyKey);

  async function fillForm() {
    renderDialog();
    fireEvent.change(screen.getByLabelText(/^לקוח/), { target: { value: 'דנ' } });
    fireEvent.click(await screen.findByRole('button', { name: 'דנה לוי' }));
    fireEvent.click(await screen.findByRole('checkbox'));
  }

  const submit = async (times: number) => {
    const button = screen.getByRole('button', { name: 'יצירה ושליחה' });
    for (let i = 1; i <= times; i++) {
      fireEvent.click(button);
      await waitFor(() => expect(keysSent()).toHaveLength(i));
      await waitFor(() => expect(button).not.toBeDisabled());
    }
  };

  it('sends the same key when the same submission is retried', async () => {
    await fillForm();
    await submit(2);

    const [first, second] = keysSent();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toBe(first);
  });

  it('sends a new key once the submission changes', async () => {
    await fillForm();
    await submit(1);
    fireEvent.change(screen.getByLabelText('הערות ללקוח'), { target: { value: 'בבקשה בבוקר' } });
    fireEvent.click(screen.getByRole('button', { name: 'יצירה ושליחה' }));
    await waitFor(() => expect(keysSent()).toHaveLength(2));

    const [first, second] = keysSent();
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });
});
