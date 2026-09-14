import { Check, Circle, FileText, Users, Wrench, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui';
import { formatCurrency } from '@/lib/utils';
import type { OnboardingSummary } from './onboarding-api';

const VERTICAL_LABEL: Record<string, string> = {
  MAINTENANCE: 'חברת אחזקה',
  CARPENTRY: 'נגרייה',
  RETAIL: 'חנות קמעונאית',
};

/**
 * מה כבר נאסף.
 *
 * שיחה בלי משוב נראית אינסופית — המשתמש לא יודע אם הוא באמצע או
 * בסוף. הסרגל הופך את ההתקדמות לגלויה, ומראה את מה שהמודל *רשם
 * בפועל* ולא את מה שנאמר. פער בין השניים הוא בדיוק מה שהמשתמש
 * צריך לראות כדי לתקן.
 */
export function OnboardingSidebar({
  summary,
  isLoading,
}: {
  summary?: OnboardingSummary;
  isLoading: boolean;
}) {
  if (isLoading || !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>מה נאסף עד כה</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const company = summary.companyInfo;
  const companyDone = Boolean(company?.legalName && company.vertical && company.contactEmail);
  const team = summary.teamMembers ?? [];
  const prices = summary.priceCodes ?? [];
  const jobs = summary.jobTypes ?? [];
  const docs = summary.documentCounts.quotes + summary.documentCounts.materialOrders;

  return (
    <Card>
      <CardHeader>
        <CardTitle>מה נאסף עד כה</CardTitle>
      </CardHeader>

      <div className="divide-y divide-border">
        <Section icon={Building2} title="פרטי החברה" done={companyDone}>
          {company?.legalName ? (
            <>
              <Line>{company.legalName}</Line>
              {company.vertical ? <Line muted>{VERTICAL_LABEL[company.vertical]}</Line> : null}
              {company.businessId ? (
                <Line muted>
                  ח.פ <span className="ltr-inline">{company.businessId}</span>
                </Line>
              ) : null}
              {company.contactEmail ? (
                <Line muted>
                  <span className="ltr-inline">{company.contactEmail}</span>
                </Line>
              ) : null}
            </>
          ) : (
            <Line muted>עדיין לא נמסרו</Line>
          )}
        </Section>

        <Section icon={Users} title="צוות" done={team.length > 0} count={team.length}>
          {team.length === 0 ? (
            <Line muted>עדיין לא נמסרו</Line>
          ) : (
            team.slice(0, 4).map((m) => (
              <Line key={m.email}>
                {m.name} <span className="text-fg-subtle">· {m.role}</span>
              </Line>
            ))
          )}
          {team.length > 4 ? <Line muted>ועוד {team.length - 4}</Line> : null}
        </Section>

        <Section icon={Wrench} title="סוגי עבודה" done={jobs.length > 0} count={jobs.length}>
          {jobs.length === 0 ? (
            <Line muted>עדיין לא נמסרו</Line>
          ) : (
            jobs.slice(0, 4).map((j) => <Line key={j.name}>{j.name}</Line>)
          )}
          {jobs.length > 4 ? <Line muted>ועוד {jobs.length - 4}</Line> : null}
        </Section>

        <Section icon={FileText} title="מחירון" done={prices.length > 0} count={prices.length}>
          {prices.length === 0 ? (
            <Line muted>עדיין לא נמסר</Line>
          ) : (
            prices.slice(0, 4).map((p) => (
              <Line key={p.code}>
                <span className="flex justify-between gap-2">
                  <span className="truncate">{p.description}</span>
                  <span className="tabular shrink-0 text-fg-muted">
                    {formatCurrency(p.defaultPrice)}
                  </span>
                </span>
              </Line>
            ))
          )}
          {prices.length > 4 ? <Line muted>ועוד {prices.length - 4}</Line> : null}
        </Section>

        {docs > 0 ? (
          <Section icon={FileText} title="מסמכים" done count={docs}>
            <Line muted>
              {summary.documentCounts.quotes} הצעות מחיר · {summary.documentCounts.materialOrders}{' '}
              הזמנות חומרים
            </Line>
          </Section>
        ) : null}
      </div>
    </Card>
  );
}

function Section({
  icon: Icon,
  title,
  done,
  count,
  children,
}: {
  icon: typeof Users;
  title: string;
  done: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-3.5">
      <div className="mb-1.5 flex items-center gap-2">
        {/* צורה ולא רק צבע: ✓ מול עיגול ריק. */}
        {done ? (
          <Check className="size-3.5 shrink-0 text-success" aria-label="הושלם" />
        ) : (
          <Circle className="size-3.5 shrink-0 text-fg-subtle" aria-label="ממתין" />
        )}
        <Icon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="text-xs font-medium text-fg">{title}</span>
        {count ? <span className="tabular text-2xs text-fg-subtle">({count})</span> : null}
      </div>
      <div className="space-y-0.5 ps-7">{children}</div>
    </div>
  );
}

function Line({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return <p className={muted ? 'text-2xs text-fg-subtle' : 'text-2xs text-fg-muted'}>{children}</p>;
}
