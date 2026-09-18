import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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
  request.mockImplementation(async (path: string) => {
    if (path.startsWith('/customers/search')) return customers;
    if (path.startsWith('/price-list')) return [];
    throw new Error(`unexpected request: ${path}`);
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
