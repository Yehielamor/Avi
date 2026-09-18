import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import { PriceItemDialog } from './price-item-dialog';
import * as api from './price-list-api';
import type { PriceListItem } from './price-list-api';

/**
 * הדיאלוג שמשנה מחירים.
 *
 * מה שנבדק כאן הוא מה שיכול לשבש כסף או יומן ביקורת בלי שאיש ישים לב:
 * פסיק עשרוני שהופך לשגיאה במקום למחיר, עדכון שנשלח כשלא השתנה דבר,
 * ו-409 שנעלם ב-toast במקום להצביע על השדה.
 */
vi.mock('./price-list-api', async (orig) => ({
  ...(await orig<typeof import('./price-list-api')>()),
  createPriceListItem: vi.fn(),
  updatePriceListItem: vi.fn(),
}));

const create = vi.mocked(api.createPriceListItem);
const update = vi.mocked(api.updatePriceListItem);

const existing: PriceListItem = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'AC-FIX',
  description: 'תיקון מזגן',
  price: '149.9',
  isActive: true,
  usedByTemplates: 3,
  updatedAt: '2026-09-18T10:00:00.000Z',
};

function renderDialog(item: PriceListItem | null, onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  render(<PriceItemDialog item={item} onClose={onClose} />, { wrapper: wrap });
  return { onClose };
}

const type = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => {
  create.mockReset();
  update.mockReset();
});

describe('PriceItemDialog — create', () => {
  it('accepts a Hebrew-keyboard decimal comma and sends a dot', async () => {
    create.mockResolvedValue({ ...existing, id: '22222222-2222-2222-2222-222222222222' });
    renderDialog(null);

    type(/^קוד/, 'NEW-1');
    type(/^תיאור/, 'בדיקה');
    type(/^מחיר/, '149,90');
    submit(/הוספה למחירון/);

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({ code: 'NEW-1', description: 'בדיקה', price: '149.90' });
  });

  it.each([
    ['three decimal places', '10.999'],
    ['a negative number', '-5'],
    ['scientific notation', '1e3'],
    ['text', 'abc'],
  ])('rejects %s without calling the server', async (_label, price) => {
    renderDialog(null);
    type(/^קוד/, 'X');
    type(/^תיאור/, 'x');
    type(/^מחיר/, price);
    submit(/הוספה למחירון/);

    expect(await screen.findByText(/עד שתי ספרות אחרי הנקודה/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('pins a duplicate-code 409 to the code field, not just a toast', async () => {
    create.mockRejectedValue(new ApiError(409, 'Price code "DUP" already exists'));
    renderDialog(null);

    type(/^קוד/, 'DUP');
    type(/^תיאור/, 'x');
    type(/^מחיר/, '10');
    submit(/הוספה למחירון/);

    expect(await screen.findByText('הקוד הזה כבר קיים במחירון')).toBeInTheDocument();
  });
});

describe('PriceItemDialog — edit', () => {
  it('does not let the code be changed', () => {
    renderDialog(existing);
    expect(screen.getByLabelText(/^קוד/)).toHaveAttribute('readonly');
  });

  it('sends only the price when only the price changed', async () => {
    update.mockResolvedValue({ ...existing, price: '175' });
    renderDialog(existing);

    type(/^מחיר/, '175');
    submit(/^שמירה$/);

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(existing.id, { price: '175' });
  });

  it('treats 149.9 and 149.90 as the same price and sends nothing', async () => {
    // אחרת היומן היה מתעד "שינוי מחיר" מ-149.9 ל-149.90.
    const { onClose } = renderDialog(existing);

    type(/^מחיר/, '149.90');
    submit(/^שמירה$/);

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(update).not.toHaveBeenCalled();
  });

  it('warns before deactivating a code that active templates still use', () => {
    renderDialog(existing);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByRole('alert')).toHaveTextContent('3 תבניות עבודה פעילות');
  });

  it('does not warn when the code is unused', () => {
    renderDialog({ ...existing, usedByTemplates: 0 });
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
