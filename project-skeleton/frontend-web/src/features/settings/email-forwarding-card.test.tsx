import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import * as api from '@/lib/api';
import { EmailForwardingCard, type Mailbox } from './email-forwarding-card';

/** מה בעל העסק רואה בכל שלב של הגדרת ההעברה ב-Gmail. */
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof import('@/lib/api')>()),
  request: vi.fn(),
}));
const request = vi.mocked(api.request);

const base: Mailbox = {
  enabled: true,
  address: 'ac-maintenance-abcdefghij@in.craftmind-ai.com',
  verificationCode: null,
  verificationUrl: null,
  verificationReceivedAt: null,
  lastReceivedAt: null,
  receivedCount: 0,
};

function renderCard(m: Mailbox) {
  request.mockResolvedValue(m);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <EmailForwardingCard />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => request.mockReset());

describe('EmailForwardingCard', () => {
  it('shows the address left-to-right, and that setup has not started', async () => {
    renderCard(base);
    expect(await screen.findByText(base.address)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('טרם הוגדר')).toBeInTheDocument();
    expect(screen.queryByText('קוד האימות מ-Gmail')).not.toBeInTheDocument();
  });

  it('puts Gmail’s verification code front and centre while waiting', async () => {
    renderCard({ ...base, verificationCode: '987654321', verificationReceivedAt: new Date().toISOString() });
    expect(await screen.findByText('987654321')).toBeInTheDocument();
    expect(screen.getByText('ממתין לאימות ב-Gmail')).toBeInTheDocument();
  });

  it('reports it is working once mail arrives', async () => {
    renderCard({ ...base, receivedCount: 3, lastReceivedAt: new Date().toISOString() });
    expect(await screen.findByText(/פעיל · מייל אחרון/)).toBeInTheDocument();
  });

  it('warns when the server has not enabled intake yet', async () => {
    renderCard({ ...base, enabled: false });
    expect(await screen.findByText(/הקליטה עדיין לא הופעלה בשרת/)).toBeInTheDocument();
  });
});
