import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivationChecklist, BriefView, WeeklyValue, type Brief } from './morning-brief';

/**
 * תדריך הבוקר: מה מוצג, ובעיקר מה לא — סכום שלא ידוע לא מוצג כאפס,
 * והערכה מסומנת כהערכה.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const empty: Brief = {
  today: [],
  needsReply: { reschedules: [], expiringQuotes: [] },
  moneyWaiting: {
    approvedUnscheduled: { count: 0, amount: '0.00' },
    closedUnbilled: { count: 0, estimatedAmount: '0.00' },
    maintenanceDue: { count: 0, estimatedAmount: null },
  },
  week: { bookedByCustomers: 0, quotesApproved: 0, quotesApprovedAmount: '0.00', visitsConfirmed: 0, statusLinksSent: 0, jobsClosed: 0 },
};

beforeEach(() => localStorage.clear());

describe('BriefView', () => {
  it('shows calm empty states and no weekly card when nothing happened', () => {
    render(<BriefView brief={empty} />);
    expect(screen.getByText('אין ביקורים מתוכננים להיום.')).toBeInTheDocument();
    expect(screen.getByText(/הכל מטופל/)).toBeInTheDocument();
    expect(screen.queryByText('מה CraftMind עשה בשבילך השבוע')).not.toBeInTheDocument();
  });

  it('marks estimates, and shows maintenance without an amount when there is no history', () => {
    render(
      <BriefView
        brief={{
          ...empty,
          moneyWaiting: {
            approvedUnscheduled: { count: 1, amount: '750.25' },
            closedUnbilled: { count: 3, estimatedAmount: '1200.00' },
            maintenanceDue: { count: 12, estimatedAmount: null },
          },
        }}
      />,
    );
    expect(screen.getByText('הצעה שאושרה ועוד לא תואמה').closest('a')).toHaveAttribute('href', '/quotes');
    expect(screen.getByText('3 עבודות שנסגרו ולא חויבו').closest('a')?.textContent).toContain('כ-');
    const maintenance = screen.getByText('12 יחידות ציוד שמגיע להן טיפול').closest('a')!;
    expect(maintenance).toHaveAttribute('href', '/maintenance');
    expect(maintenance.textContent).not.toMatch(/₪|0\.00/);
  });

  it('links a reschedule request straight to its task', () => {
    render(
      <BriefView
        brief={{
          ...empty,
          needsReply: {
            reschedules: [{ taskId: '11111111-1111-1111-1111-111111111111', title: 't', customerName: 'רונית', note: 'אחרי 16:00' }],
            expiringQuotes: [],
          },
        }}
      />,
    );
    expect(screen.getByText('רונית מבקש/ת מועד אחר').closest('a')).toHaveAttribute('href', '/tasks/$taskId');
    expect(screen.getByText('"אחרי 16:00"')).toBeInTheDocument();
  });
});

describe('WeeklyValue', () => {
  it('lists only what actually happened', () => {
    render(<WeeklyValue week={{ ...empty.week, quotesApproved: 2, quotesApprovedAmount: '1500.00', jobsClosed: 1 }} />);
    expect(screen.getByText(/2 הצעות מחיר אושרו/)).toBeInTheDocument();
    expect(screen.getByText('עבודה נסגרה')).toBeInTheDocument();
    expect(screen.queryByText(/קישור מעקב/)).not.toBeInTheDocument();
  });
});

describe('ActivationChecklist', () => {
  const activation = {
    steps: [
      { key: 'priceList' as const, done: true },
      { key: 'equipment' as const, done: false },
      { key: 'statusLink' as const, done: false },
      { key: 'quote' as const, done: false },
    ],
    completed: 1,
    total: 4,
    allDone: false,
  };

  it('shows progress and the reason for each open step', () => {
    render(<ActivationChecklist activation={activation} />);
    expect(screen.getByText('1 מתוך 4 הושלמו')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText(/המערכת תזכיר מתי מגיע לו טיפול/)).toBeInTheDocument();
  });

  it('stays hidden once dismissed', () => {
    localStorage.setItem('craftmind.activation.hidden', '1');
    render(<ActivationChecklist activation={activation} />);
    expect(screen.queryByText(/ארבעה צעדים/)).not.toBeInTheDocument();
  });
});
